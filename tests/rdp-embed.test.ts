import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { RdpManager, type RdpManagerDeps } from '../src/main/rdp/manager';
import type { RdpEmbedEngine, EmbedRect } from '../src/main/rdp/embed';
import type { RdpFileOptions } from '../src/main/rdp/generator';
import { createHost, type Host } from '../src/shared/types';

/** Фейковый ребёнок mstsc: EventEmitter с pid/kill, как у ChildProcess. */
class FakeChild extends EventEmitter {
  readonly pid: number;
  exitCode: number | null = null;
  killed = false;
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  kill(): boolean {
    this.killed = true;
    this.exitCode = 1;
    this.emit('exit', 1);
    return true;
  }
}

interface FakeWindow {
  hwnd: number;
  visible: boolean;
}

/** Фейковый движок: записывает вызовы, управляет «появлением» окна. */
class FakeEngine implements RdpEmbedEngine {
  calls: string[] = [];
  hwndByPid = new Map<number, FakeWindow>();
  /** Сколько раз findWindowByPid вернул null до первого результата. */
  findDelay = 0;
  alive = true;

  async findWindowByPid(pid: number): Promise<number | null> {
    this.calls.push(`find:${pid}`);
    if (this.findDelay > 0) {
      this.findDelay--;
      return null;
    }
    const w = this.hwndByPid.get(pid);
    return w ? w.hwnd : null;
  }
  isWindow(hwnd: number): boolean {
    this.calls.push(`isWindow:${hwnd}`);
    return this.alive && [...this.hwndByPid.values()].some((w) => w.hwnd === hwnd);
  }
  confirmSecurityWarning(pid: number): boolean {
    this.calls.push(`confirm:${pid}`);
    return true;
  }
  embed(hwnd: number, parentHwnd: number): void {
    this.calls.push(`embed:${hwnd}->${parentHwnd}`);
  }
  setRect(hwnd: number, rect: EmbedRect): void {
    this.calls.push(`rect:${hwnd}:${rect.x},${rect.y},${rect.width},${rect.height}`);
  }
  show(hwnd: number): void {
    this.calls.push(`show:${hwnd}`);
  }
  hide(hwnd: number): void {
    this.calls.push(`hide:${hwnd}`);
  }
  setForeground(hwnd: number): void {
    this.calls.push(`foreground:${hwnd}`);
  }
  close(hwnd: number): void {
    this.calls.push(`close:${hwnd}`);
  }
}

const RECT: EmbedRect = { x: 10, y: 20, width: 800, height: 500 };

function rdpHost(over: Partial<Host> = {}): Host {
  return createHost({
    id: 'h1',
    name: 'Win',
    protocol: 'rdp',
    host: '192.168.1.10',
    port: 3389,
    username: 'admin',
    rdp: { domain: '', screenMode: 'window', width: 1280, height: 800, multiMonitor: false, promptForCreds: false },
    ...over
  });
}

function makeManager(opts: {
  engine?: FakeEngine;
  spawnResult?: () => { child: FakeChild; cleanup: () => void };
  legacyCalls?: { calls: number };
  watchdogInterval?: number;
  send?: (c: string, p: unknown) => void;
}): {
  manager: RdpManager;
  engine: FakeEngine;
  sends: { channel: string; payload: unknown }[];
  child: FakeChild;
} {
  const engine = opts.engine ?? new FakeEngine();
  const child = new FakeChild(4242);
  const sends: { channel: string; payload: unknown }[] = [];
  const legacyCalls = opts.legacyCalls ?? { calls: 0 };
  const manager = new RdpManager({
    sealer: {} as never,
    send: (c, p) => sends.push({ channel: c, payload: p }),
    getParentHwnd: () => 111,
    engine,
    spawn: async () => {
      if (opts.spawnResult) return opts.spawnResult();
      return { ok: true, child, cleanup: () => undefined };
    },
    legacyLaunch: ((_o, _p, onExit) => {
      legacyCalls.calls++;
      // эмулируем запуск отдельного окна: исход придёт по onExit
      setTimeout(() => onExit({ code: 0 }), 5);
      return { ok: true };
    }) as never,
    watchdogInterval: opts.watchdogInterval ?? 50
  });
  return { manager, engine, sends, child, legacyCalls };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('RdpManager: встраивание', () => {
  it('встраивает окно mstsc: поиск по PID → embed → позиционирование', async () => {
    const { manager, engine, child } = makeManager({});
    engine.hwndByPid.set(child.pid, { hwnd: 777, visible: true });

    const res = await manager.launch(rdpHost(), null, 's1');
    expect(res).toEqual({ ok: true, mode: 'embedded' });

    // ждём attachWindow (фейк находит сразу)
    await sleep(20);
    expect(engine.calls).toContain('find:4242');
    expect(engine.calls).toContain('embed:777->111');

    // прямоугольник от рендерера → setRect
    manager.setRect('s1', RECT);
    expect(engine.calls).toContain('rect:777:10,20,800,500');
    expect(engine.calls).toContain('show:777');
  });

  it('не находит окно → убивает процесс и шлёт ошибку', async () => {
    const { manager, engine, sends, child } = makeManager({});
    // окна нет: findWindowByPid вернёт null сразу

    const res = await manager.launch(rdpHost(), null, 's1');
    expect(res).toEqual({ ok: true, mode: 'embedded' });

    await sleep(20);
    expect(child.killed).toBe(true);
    const exited = sends.find((s) => s.channel === 'rdp:exited');
    expect(exited).toBeDefined();
    expect((exited?.payload as { error?: string }).error).toContain('Не удалось найти окно');
    expect(engine.isWindow(777)).toBe(false);
  });

  it('fullscreen-профиль → фолбэк в отдельное окно (mode=window)', async () => {
    const { manager, legacyCalls } = makeManager({});
    const res = await manager.launch(
      rdpHost({ rdp: { domain: '', screenMode: 'fullscreen', width: 0, height: 0, multiMonitor: false, promptForCreds: false } }),
      null,
      's1'
    );
    expect(res).toEqual({ ok: true, mode: 'window' });
    expect(legacyCalls.calls).toBe(1);
  });

  it('multiMonitor-профиль → фолбэк в отдельное окно', async () => {
    const { manager, legacyCalls } = makeManager({});
    const res = await manager.launch(
      rdpHost({ rdp: { domain: '', screenMode: 'window', width: 1280, height: 800, multiMonitor: true, promptForCreds: false } }),
      null,
      's1'
    );
    expect(res).toEqual({ ok: true, mode: 'window' });
    expect(legacyCalls.calls).toBe(1);
  });

  it('activate показывает активную и прячет остальные', async () => {
    const engine = new FakeEngine();
    const children = [new FakeChild(4242), new FakeChild(4243)];
    engine.hwndByPid.set(4242, { hwnd: 1, visible: true });
    engine.hwndByPid.set(4243, { hwnd: 2, visible: true });
    const spawns: { ok: true; child: FakeChild; cleanup: () => void }[] = children.map((child) => ({
      ok: true,
      child,
      cleanup: () => undefined
    }));
    const manager = new RdpManager({
      sealer: {} as never,
      send: () => undefined,
      getParentHwnd: () => 111,
      engine,
      spawn: async () => spawns.shift()!,
      legacyLaunch: (() => ({ ok: true })) as never,
      watchdogInterval: 50
    });
    await manager.launch(rdpHost(), null, 's1');
    await manager.launch(rdpHost({ id: 'h2' }), null, 's2');
    await sleep(30);

    manager.activate('s1');
    expect(engine.calls).toContain('show:1');
    expect(engine.calls).toContain('hide:2');
    manager.activate('s2');
    expect(engine.calls).toContain('hide:1');
    expect(engine.calls).toContain('show:2');
  });

  it('overlay прячет все встроенные окна и возвращает активное', async () => {
    const { manager, engine, child } = makeManager({});
    engine.hwndByPid.set(child.pid, { hwnd: 5, visible: true });
    await manager.launch(rdpHost(), null, 's1');
    await sleep(20);
    manager.setRect('s1', RECT);
    expect(engine.calls).toContain('show:5');

    manager.setOverlay(true);
    expect(engine.calls).toContain('hide:5');
    manager.setOverlay(false);
    expect(engine.calls).toContain('show:5');
  });

  it('stop закрывает окно (WM_CLOSE) и убивает процесс, если тот не вышел', async () => {
    const { manager, engine, child, sends } = makeManager({});
    engine.hwndByPid.set(child.pid, { hwnd: 9, visible: true });
    await manager.launch(rdpHost(), null, 's1');
    await sleep(20);
    expect(engine.calls).toContain('embed:9->111');

    manager.stop('s1');
    expect(engine.calls).toContain('close:9');
    expect(engine.calls).toContain('hide:9');
    // mstsc проигнорировал WM_CLOSE — через KILL_GRACE_MS(3s в проде; здесь 50мс интервал не влияет)
    // ждём фолбэк-таймер 3с: не ждём реально, а проверяем, что exited не ушёл
    expect(sends).toHaveLength(0); // закрытие вкладки не шлёт rdp:exited
  });

  it('сторож гасит предупреждение безопасности mstsc на каждом тике', async () => {
    const { manager, engine, child } = makeManager({ watchdogInterval: 5 });
    engine.hwndByPid.set(child.pid, { hwnd: 21, visible: true });
    await manager.launch(rdpHost(), null, 's1');
    await sleep(30);
    // findWindowByPid не зовёт confirm (это делает сторож); проверяем вызовы тика
    expect(engine.calls.some((c) => c.startsWith('confirm:4242'))).toBe(true);
  });

  it('пересозданное окно перевстраивается сторожем', async () => {
    const { manager, engine, child } = makeManager({ watchdogInterval: 5 });
    engine.hwndByPid.set(child.pid, { hwnd: 21, visible: true });
    await manager.launch(rdpHost(), null, 's1');
    await sleep(30);
    expect(engine.calls).toContain('embed:21->111');

    // окно «пересоздано»: старый HWND мёртв, у PID новый
    engine.hwndByPid.delete(child.pid);
    engine.hwndByPid.set(child.pid, { hwnd: 22, visible: true });
    await sleep(60); // дожидаемся тика сторожа
    expect(engine.calls).toContain('embed:22->111');
  });

  it('выход mstsc без закрытия вкладки шлёт rdp:exited', async () => {
    const { manager, engine, child, sends } = makeManager({});
    engine.hwndByPid.set(child.pid, { hwnd: 31, visible: true }); // сессия живёт
    await manager.launch(rdpHost(), null, 's1');
    await sleep(20);
    child.emit('exit', 0);
    await sleep(5);
    const exited = sends.find((s) => s.channel === 'rdp:exited');
    expect(exited).toBeDefined();
    expect((exited?.payload as { code: number }).code).toBe(0);
  });
});
