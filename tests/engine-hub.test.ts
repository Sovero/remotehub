import { describe, it, expect, vi } from 'vitest';
import {
  RdpEngineHub,
  type IronGatewayDeps,
  type LegacyEngineLike,
  type RdpjsEngineLike
} from '../src/main/rdp/engine-hub';
import type { RdpEngineStatePayload } from '../src/shared/rdp-engine';

/** Фейк RdpjsClientManager: фиксирует вызовы, ничего не делает по-настоящему. */
function fakeRdpjs(): RdpjsEngineLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    connect: vi.fn(async () => ({ ok: true })),
    disconnect: vi.fn((id: string) => calls.push(`disconnect:${id}`)),
    sendMouse: vi.fn(() => calls.push('sendMouse')),
    sendWheel: vi.fn(() => calls.push('sendWheel')),
    sendKeyScancode: vi.fn(() => calls.push('sendKeyScancode')),
    sendKeyUnicode: vi.fn(() => calls.push('sendKeyUnicode')),
    closeAll: vi.fn(() => calls.push('closeAll'))
  };
}

/** Фейк RdpManager (legacy/COM-host). */
function fakeLegacy(): LegacyEngineLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    launch: vi.fn(async () => ({ ok: true })),
    stop: vi.fn((id: string) => calls.push(`stop:${id}`)),
    setRect: vi.fn(() => calls.push('setRect')),
    activate: vi.fn(() => calls.push('activate')),
    hide: vi.fn(() => calls.push('hide')),
    setOverlay: vi.fn(() => calls.push('setOverlay')),
    closeAll: vi.fn(() => calls.push('closeAll'))
  };
}

/** Фейк iron-моста: start можно заставить резолвиться или падать. */
function fakeIron() {
  let resolveWith: { wsUrl: string; authToken: string } | null = { wsUrl: 'ws://127.0.0.1:1/?token=t', authToken: 't' };
  let rejectWith: Error | null = null;
  let capturedOnState: NonNullable<Parameters<IronGatewayDeps['start']>[0]['onState']> | null = null;
  const deps: IronGatewayDeps & { calls: string[] } = {
    calls: [],
    start: vi.fn(async (opts) => {
      deps.calls.push(`start:${opts.sessionId}`);
      capturedOnState = opts.onState ?? null;
      if (rejectWith) throw rejectWith;
      return resolveWith as { wsUrl: string; authToken: string };
    }),
    stop: vi.fn(async (id: string) => {
      deps.calls.push(`stop:${id}`);
    }),
    stopAll: vi.fn(async () => {
      deps.calls.push('stopAll');
    }),
    /** Тест вызывает событие состояния, как будто его эмитил реальный мост. */
    emitState: (sessionId: string, state: { phase: 'connecting' | 'connected' | 'error' | 'closed'; message?: string }) => {
      capturedOnState?.(sessionId, state);
    }
  };
  return { deps, setResolve: (v: typeof resolveWith) => (resolveWith = v), setReject: (e: Error) => (rejectWith = e) };
}

/** Хаб с фейками + журнал единого потока состояний. */
function makeHub() {
  const states: RdpEngineStatePayload[] = [];
  const rdpjs = fakeRdpjs();
  const legacy = fakeLegacy();
  const iron = fakeIron();
  const hub = new RdpEngineHub({
    rdpjs,
    legacy,
    iron: iron.deps,
    onState: (p) => states.push(p)
  });
  return { hub, rdpjs, legacy, iron, states };
}

const rdpjsReq = (sessionId = 's1') => ({
  sessionId,
  engine: 'rdpjs' as const,
  host: 'h1',
  port: 3389,
  username: 'u',
  password: 'p'
});

describe('RdpEngineHub — attribution (владелец сессии)', () => {
  it('connect фиксирует владельца; disconnect закрывает РОВНО движок-владельца', async () => {
    const { hub, rdpjs, legacy } = makeHub();
    const res = await hub.connect(rdpjsReq());
    expect(res.ok).toBe(true);
    expect(hub.engineOf('s1')).toBe('rdpjs');

    hub.disconnect('s1');
    expect(rdpjs.calls).toContain('disconnect:s1');
    expect(legacy.calls).toEqual([]); // латентный кросс-движковый баг: legacy не дёргается
  });

  it('disconnect неизвестной сессии — no-op', () => {
    const { hub, rdpjs, legacy } = makeHub();
    hub.disconnect('ghost');
    expect(rdpjs.calls).toEqual([]);
    expect(legacy.calls).toEqual([]);
  });

  it('повторный closeTab мёртвой сессии — no-op (событие сняло владельца)', async () => {
    const { hub, rdpjs, iron } = makeHub();
    await hub.connect(rdpjsReq());
    // rdpjs-движок сообщил о разрыве:
    hub.handleEngineEvent('rdpjs', 's1', { phase: 'disconnected' });
    expect(hub.engineOf('s1')).toBeNull();
    hub.disconnect('s1');
    expect(rdpjs.calls.filter((c) => c.startsWith('disconnect'))).toEqual([]);
    expect(iron.deps.calls).toEqual([]);
  });

  it('iron: connect возвращает bridge-секреты, владельцем становится iron', async () => {
    const { hub, iron } = makeHub();
    const res = await hub.connect({
      sessionId: 's2',
      engine: 'iron',
      host: 'farm',
      port: 3390,
      username: 'u',
      password: 'p',
      domain: 'D'
    });
    expect(res.ok).toBe(true);
    expect(res.bridge).toMatchObject({
      wsUrl: 'ws://127.0.0.1:1/?token=t',
      authToken: 't',
      destination: 'farm:3390',
      username: 'u',
      password: 'p',
      domain: 'D'
    });
    expect(hub.engineOf('s2')).toBe('iron');
    hub.disconnect('s2');
    expect(iron.deps.calls).toContain('stop:s2');
  });

  it('iron: ошибка подъёма моста → ok:false, владелец не фиксируется', async () => {
    const { hub, iron } = makeHub();
    iron.setResolve(null);
    iron.setReject(new Error('порт занят'));
    const res = await hub.connect({ sessionId: 's3', engine: 'iron', host: 'h', username: 'u', password: 'p' });
    expect(res).toEqual({ ok: false, error: 'порт занят' });
    expect(hub.engineOf('s3')).toBeNull();
  });

  it('legacy: без hostProfile — отказ; с профилем — владельцем становится legacy', async () => {
    const { hub, legacy } = makeHub();
    const bad = await hub.connect({ sessionId: 's4', engine: 'legacy', host: 'h' });
    expect(bad.ok).toBe(false);

    const ok = await hub.connect({
      sessionId: 's4',
      engine: 'legacy',
      host: 'h',
      hostProfile: { id: 'h', name: 'h', host: 'h' } as never,
      credential: null
    });
    expect(ok.ok).toBe(true);
    expect(hub.engineOf('s4')).toBe('legacy');
    expect(legacy.calls).toEqual([]);
  });
});

describe('RdpEngineHub — маршрутизация по capability-флагам', () => {
  it('ввод уходит только в rdpjs и только если сессия принадлежит rdpjs', async () => {
    const { hub, rdpjs } = makeHub();
    await hub.connect(rdpjsReq());
    hub.sendMouse('s1', 1, 2, 0, true);
    hub.sendMouseMove('s1', 3, 4);
    hub.sendWheel('s1', 5, 6, 1, false, false);
    hub.sendKeyUnicode('s1', 65, true);
    hub.sendKeyScancode('s1', 30, false);
    expect(rdpjs.calls).toEqual(['sendMouse', 'sendMouse', 'sendWheel', 'sendKeyUnicode', 'sendKeyScancode']);
  });

  it('ввод legacy-сессии в rdpjs не попадает', async () => {
    const { hub, rdpjs } = makeHub();
    await hub.connect({
      sessionId: 's5',
      engine: 'legacy',
      host: 'h',
      hostProfile: { id: 'h', name: 'h', host: 'h' } as never,
      credential: null
    });
    hub.sendMouse('s5', 1, 2, 0, true);
    expect(rdpjs.calls).toEqual([]);
  });

  it('оконные команды уходят только в legacy', async () => {
    const { hub, legacy } = makeHub();
    await hub.connect({
      sessionId: 's6',
      engine: 'legacy',
      host: 'h',
      hostProfile: { id: 'h', name: 'h', host: 'h' } as never,
      credential: null
    });
    hub.setRect('s6', { x: 0, y: 0, width: 10, height: 10 });
    hub.activate('s6');
    hub.hide('s6');
    hub.setOverlay(true);
    expect(legacy.calls).toEqual(['setRect', 'activate', 'hide', 'setOverlay']);
  });
});

describe('RdpEngineHub — единый поток состояний', () => {
  it('событие rdpjs транслируется в payload с engine-атрибуцией', async () => {
    const { hub, states } = makeHub();
    await hub.connect(rdpjsReq());
    hub.handleEngineEvent('rdpjs', 's1', { phase: 'connected' });
    expect(states.at(-1)).toEqual({ sessionId: 's1', engine: 'rdpjs', phase: 'connected' });
  });

  it('выход COM-host с ошибкой → error; штатный выход → disconnected с кодом', () => {
    const { hub, states } = makeHub();
    hub.handleLegacyProcessExit({ sessionId: 's7', code: null, error: 'RDP COM-хост ошибка: boom' });
    expect(states.at(-1)).toEqual({ sessionId: 's7', engine: 'legacy', phase: 'error', message: 'RDP COM-хост ошибка: boom' });
    expect(hub.engineOf('s7')).toBeNull();

    hub.handleEngineEvent('legacy', 's7', { phase: 'connecting' }); // «живая» сессия
    hub.handleLegacyProcessExit({ sessionId: 's7', code: 0 });
    expect(states.at(-1)).toEqual({
      sessionId: 's7',
      engine: 'legacy',
      phase: 'disconnected',
      message: 'RDP-сессия завершена',
      exitCode: 0
    });
  });

  it('событие сторожа iron-моста (error/closed) доходит до renderer, сессия разатрибутируется', async () => {
    const { hub, iron, states } = makeHub();
    await hub.connect({ sessionId: 's8', engine: 'iron', host: 'h', username: 'u', password: 'p' });
    iron.deps.emitState('s8', { phase: 'error', message: 'TLS silence watchdog' });
    expect(states.at(-1)).toEqual({ sessionId: 's8', engine: 'iron', phase: 'error', message: 'TLS silence watchdog' });
    expect(hub.engineOf('s8')).toBeNull();
    iron.deps.emitState('s8', { phase: 'closed' });
    expect(states.at(-1)).toEqual({ sessionId: 's8', engine: 'iron', phase: 'disconnected' });
  });
});

describe('RdpEngineHub — closeAll (before-quit)', () => {
  it('закрывает все три движка и снимает всех владельцев', async () => {
    const { hub, rdpjs, legacy, iron } = makeHub();
    await hub.connect(rdpjsReq('a'));
    await hub.connect({ sessionId: 'b', engine: 'legacy', host: 'h', hostProfile: { id: 'h', name: 'h', host: 'h' } as never, credential: null });
    await hub.connect({ sessionId: 'c', engine: 'iron', host: 'h', username: 'u', password: 'p' });

    await hub.closeAll();
    expect(rdpjs.calls).toContain('closeAll');
    expect(legacy.calls).toContain('closeAll');
    expect(iron.deps.calls).toContain('stopAll');
    expect(hub.engineOf('a')).toBeNull();
    expect(hub.engineOf('b')).toBeNull();
    expect(hub.engineOf('c')).toBeNull();
  });
});
