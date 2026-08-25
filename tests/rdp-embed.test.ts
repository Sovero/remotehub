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
  hwnd: bigint;
  visible: boolean;
}

/** Фейковый движок: записывает вызовы, управляет «появлением» окна. */
class FakeEngine implements RdpEmbedEngine {
  calls: string[] = [];
  hwndByPid = new Map<number, FakeWindow>();
  /** Сколько раз findWindowByPid вернул null до первого результата. */
  findDelay = 0;
  alive = true;
  warningByPid = new Map<number, bigint>();

  async findWindowByPid(pid: number): Promise<bigint | null> {
    this.calls.push(`find:${pid}`);
    if (this.findDelay > 0) {
      this.findDelay--;
      return null;
    }
    const w = this.hwndByPid.get(pid);
    return w ? w.hwnd : null;
  }
  isWindow(hwnd: bigint): boolean {
    this.calls.push(`isWindow:${hwnd}`);
    return this.alive && [...this.hwndByPid.values()].some((w) => w.hwnd === hwnd);
  }
  findSecurityWarning(pid: number): bigint | null {
    this.calls.push(`find-warning:${pid}`);
    return this.warningByPid.get(pid) ?? null;
  }
  confirmSecurityWarning(pid: number): boolean {
    this.calls.push(`confirm:${pid}`);
    this.warningByPid.delete(pid);
    return true;
  }
  rejectSecurityWarning(pid: number): boolean {
    this.calls.push(`reject:${pid}`);
    return true;
  }
  embed(hwnd: bigint, parentHwnd: bigint): void {
    this.calls.push(`embed:${hwnd}->${parentHwnd}`);
  }
  setRect(hwnd: bigint, rect: EmbedRect): void {
    this.calls.push(`rect:${hwnd}:${rect.x},${rect.y},${rect.width},${rect.height}`);
  }
  show(hwnd: bigint): void {
    this.calls.push(`show:${hwnd}`);
  }
  hide(hwnd: bigint): void {
    this.calls.push(`hide:${hwnd}`);
  }
  setForeground(hwnd: bigint): void {
    this.calls.push(`foreground:${hwnd}`);
  }
  focus(hwnd: bigint): void {
    this.calls.push(`focus:${hwnd}`);
  }
  hideAuxiliaryWindows(pid: number): void {
    this.calls.push(`hide-aux:${pid}`);
  }
  close(hwnd: bigint): void {
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
  watchdogInterval?: number;
  killGraceMs?: number;
  autoAcceptCert?: boolean;
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
  const manager = new RdpManager({
    sealer: {} as never,
    send: (c, p) => sends.push({ channel: c, payload: p }),
    getParentHwnd: () => 111n,
    engine,
    spawn: async () => {
      if (opts.spawnResult) return opts.spawnResult();
      return { ok: true, child, cleanup: () => undefined };
    },
    watchdogInterval: opts.watchdogInterval ?? 50,
    killGraceMs: opts.killGraceMs ?? 30,
    autoAcceptCert: opts.autoAcceptCert ?? true
  });
  return { manager, engine, sends, child };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('RdpManager: встраивание', () => {
  it('встраивает окно mstsc: поиск по PID → embed → позиционирование', async () => {
    const { manager, engine, child } = makeManager({});
    engine.hwndByPid.set(child.pid, { hwnd: 777n, visible: true });

    const res = await manager.launch(rdpHost(), null, 's1');
    expect(res).toEqual({ ok: true });

    // ждём attachWindow (фейк находит сразу)
    await sleep(20);
    expect(engine.calls).toContain('find:4242');
    expect(engine.calls).toContain('hide:777');
    expect(engine.calls).toContain('embed:777->111');
    expect(engine.calls.indexOf('hide:777')).toBeLessThan(engine.calls.indexOf('embed:777->111'));

    // прямоугольник от рендерера → setRect
    manager.setRect('s1', RECT);
    expect(engine.calls).toContain('rect:777:10,20,800,500');
    expect(engine.calls).toContain('show:777');
  });

  it('не находит окно → убивает процесс и шлёт ошибку', async () => {
    const { manager, engine, sends, child } = makeManager({});
    // окна нет: findWindowByPid вернёт null сразу

    const res = await manager.launch(rdpHost(), null, 's1');
    expect(res).toEqual({ ok: true });

    await sleep(20);
    expect(child.killed).toBe(true);
    const exited = sends.find((s) => s.channel === 'rdp:exited');
    expect(exited).toBeDefined();
    expect((exited?.payload as { error?: string }).error).toContain('Не удалось найти окно');
    expect(engine.isWindow(777n)).toBe(false);
  });

  it('fullscreen-профиль всё равно встраивается во вкладку', async () => {
    const { manager, engine, child } = makeManager({});
    engine.hwndByPid.set(child.pid, { hwnd: 778n, visible: true });
    const res = await manager.launch(
      rdpHost({ rdp: { domain: '', screenMode: 'fullscreen', width: 1280, height: 800, multiMonitor: false, promptForCreds: false } }),
      null,
      's1'
    );
    expect(res).toEqual({ ok: true });
    await sleep(20);
    expect(engine.calls).toContain('embed:778->111');
    expect(manager.isEmbedded('s1')).toBe(true);
  });

  it('multiMonitor-профиль адаптируется к одной встроенной сцене', async () => {
    const { manager, engine, child } = makeManager({});
    engine.hwndByPid.set(child.pid, { hwnd: 779n, visible: true });
    const res = await manager.launch(
      rdpHost({ rdp: { domain: '', screenMode: 'window', width: 1280, height: 800, multiMonitor: true, promptForCreds: false } }),
      null,
      's1'
    );
    expect(res).toEqual({ ok: true });
    await sleep(20);
    expect(engine.calls).toContain('embed:779->111');
    expect(manager.isEmbedded('s1')).toBe(true);
  });

  it('embedded fullscreen mstsc закрывается вместе с вкладкой', async () => {
    const { manager, engine, child } = makeManager({});
    engine.hwndByPid.set(child.pid, { hwnd: 780n, visible: true });
    const res = await manager.launch(
      rdpHost({ rdp: { domain: '', screenMode: 'fullscreen', width: 1280, height: 800, multiMonitor: false, promptForCreds: false } }),
      null,
      's1'
    );
    expect(res).toEqual({ ok: true });
    await sleep(20);
    manager.stop('s1');
    expect(engine.calls).toContain('close:780');
    expect(engine.calls).toContain('hide:780');
    await sleep(60);
    expect(child.killed).toBe(true);
  });

  it('activate показывает активную и прячет остальные', async () => {
    const engine = new FakeEngine();
    const children = [new FakeChild(4242), new FakeChild(4243)];
    engine.hwndByPid.set(4242, { hwnd: 1n, visible: true });
    engine.hwndByPid.set(4243, { hwnd: 2n, visible: true });
    const spawns: { ok: true; child: FakeChild; cleanup: () => void }[] = children.map((child) => ({
      ok: true,
      child,
      cleanup: () => undefined
    }));
    const manager = new RdpManager({
      sealer: {} as never,
      send: () => undefined,
      getParentHwnd: () => 111n,
      engine,
      spawn: async () => spawns.shift()!,
      watchdogInterval: 50
    });
    await manager.launch(rdpHost(), null, 's1');
    await manager.launch(rdpHost({ id: 'h2' }), null, 's2');
    await sleep(30);

    manager.activate('s1');
    expect(engine.calls).toContain('show:1');
    expect(engine.calls).toContain('hide:2');
    expect(engine.calls).toContain('focus:1');
    manager.activate('s2');
    expect(engine.calls).toContain('hide:1');
    expect(engine.calls).toContain('show:2');
    expect(engine.calls).toContain('focus:2');
  });

  it('overlay прячет все встроенные окна и возвращает активное', async () => {
    const { manager, engine, child } = makeManager({});
    engine.hwndByPid.set(child.pid, { hwnd: 5n, visible: true });
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
    engine.hwndByPid.set(child.pid, { hwnd: 9n, visible: true });
    await manager.launch(rdpHost(), null, 's1');
    await sleep(20);
    expect(engine.calls).toContain('embed:9->111');

    manager.stop('s1');
    expect(engine.calls).toContain('close:9');
    expect(engine.calls).toContain('hide:9');
    // mstsc проигнорировал WM_CLOSE — в тесте аварийная задержка сокращена.
    // Закрытие вкладки не должно послать обычный rdp:exited.
    expect(sends).toHaveLength(0); // закрытие вкладки не шлёт rdp:exited
  });

  it('сторож гасит предупреждение безопасности mstsc на каждом тике', async () => {
    const { manager, engine, child } = makeManager({ watchdogInterval: 5 });
    engine.hwndByPid.set(child.pid, { hwnd: 21n, visible: true });
    await manager.launch(rdpHost(), null, 's1');
    await sleep(30);
    // findWindowByPid не зовёт confirm (это делает менеджер); проверяем вызовы
    expect(engine.calls.some((c) => c.startsWith('confirm:4242'))).toBe(true);
  });

  it('выключенное авто-подтверждение переносит предупреждение во вкладку', async () => {
    const { manager, engine, child, sends } = makeManager({ watchdogInterval: 5, autoAcceptCert: false });
    engine.hwndByPid.set(child.pid, { hwnd: 21n, visible: true });
    engine.warningByPid.set(child.pid, 91n);
    await manager.launch(rdpHost(), null, 's1');
    await sleep(30);
    expect(engine.calls).toContain('embed:21->111');
    expect(engine.calls).toContain('hide:91');
    expect(engine.calls.some((c) => c.startsWith('confirm:4242'))).toBe(false);
    expect(sends).toContainEqual({ channel: 'rdp:certificate', payload: { sessionId: 's1', pending: true } });

    manager.acceptCertificate('s1');
    expect(engine.calls).toContain('confirm:4242');
    expect(sends).toContainEqual({ channel: 'rdp:certificate', payload: { sessionId: 's1', pending: false } });
  });

  it('отмена сертификата закрывает только текущую RDP-вкладку', async () => {
    const { manager, engine, child, sends } = makeManager({ watchdogInterval: 5, autoAcceptCert: false });
    engine.hwndByPid.set(child.pid, { hwnd: 23n, visible: true });
    engine.warningByPid.set(child.pid, 93n);
    await manager.launch(rdpHost(), null, 's1');
    await sleep(20);
    manager.rejectCertificate('s1');
    expect(engine.calls).toContain('reject:4242');
    expect(child.killed).toBe(true);
    expect(sends).toContainEqual({
      channel: 'rdp:exited',
      payload: {
        sessionId: 's1',
        code: null,
        error: 'Подключение RDP отменено: сертификат хоста не подтверждён'
      }
    });
  });

  it('пересозданное окно перевстраивается сторожем', async () => {
    const { manager, engine, child } = makeManager({ watchdogInterval: 5 });
    engine.hwndByPid.set(child.pid, { hwnd: 21n, visible: true });
    await manager.launch(rdpHost(), null, 's1');
    await sleep(30);
    expect(engine.calls).toContain('embed:21->111');

    // окно «пересоздано»: старый HWND мёртв, у PID новый
    engine.hwndByPid.delete(child.pid);
    engine.hwndByPid.set(child.pid, { hwnd: 22n, visible: true });
    await sleep(60); // дожидаемся тика сторожа
    expect(engine.calls).toContain('embed:22->111');
  });

  it('выход mstsc без закрытия вкладки шлёт rdp:exited', async () => {
    const { manager, engine, child, sends } = makeManager({});
    engine.hwndByPid.set(child.pid, { hwnd: 31n, visible: true }); // сессия живёт
    await manager.launch(rdpHost(), null, 's1');
    await sleep(20);
    child.emit('exit', 0);
    await sleep(5);
    const exited = sends.find((s) => s.channel === 'rdp:exited');
    expect(exited).toBeDefined();
    expect((exited?.payload as { code: number }).code).toBe(0);
  });
});
