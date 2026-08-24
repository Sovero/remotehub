import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { RdpManager, type RdpManagerDeps } from '../src/main/rdp/manager';
import type { RdpEmbedEngine, EmbedRect } from '../src/main/rdp/embed';
import type { RdpFileOptions } from '../src/main/rdp/generator';
import type { RdpComSpawn } from '../src/main/rdp/com-launcher';
import { createHost, type Host } from '../src/shared/types';

/**
 * Фейковый ребёнок COM-хоста: EventEmitter с pid/kill/stdin, как ChildProcess.
 * stdin — фейковый writer, который записывает отправленные команды.
 */
class FakeChild extends EventEmitter {
  readonly pid: number;
  exitCode: number | null = null;
  killed = false;
  stdinWrites: string[] = [];
  readonly stdin = {
    write: (data: string): boolean => {
      this.stdinWrites.push(data);
      return true;
    }
  };

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

/** Фейковый движок: записывает вызовы. */
class FakeEngine implements RdpEmbedEngine {
  calls: string[] = [];
  alive = true;

  async findWindowByPid(): Promise<bigint | null> {
    return null;
  }
  isWindow(): boolean {
    return this.alive;
  }
  findSecurityWarning(): bigint | null {
    return null;
  }
  confirmSecurityWarning(): boolean {
    return false;
  }
  rejectSecurityWarning(): boolean {
    return false;
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
  hideAuxiliaryWindows(): void {
    // no-op
  }
  close(hwnd: bigint): void {
    this.calls.push(`close:${hwnd}`);
  }
}

const RECT: EmbedRect = { x: 10, y: 20, width: 800, height: 500 };
const RESIZE_RECT: EmbedRect = { x: 10, y: 20, width: 1024, height: 768 };

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
  comSpawnResult?: () => { child: FakeChild; hwnd: bigint; cleanup: () => void };
  watchdogInterval?: number;
  killGraceMs?: number;
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
    comSpawn: async (): Promise<RdpComSpawn> => {
      if (opts.comSpawnResult) {
        const r = opts.comSpawnResult();
        return { ok: true, child: r.child, hwnd: r.hwnd, cleanup: r.cleanup };
      }
      return { ok: true, child, hwnd: 777n, cleanup: () => undefined };
    },
    watchdogInterval: opts.watchdogInterval ?? 50,
    killGraceMs: opts.killGraceMs ?? 30
  });
  return { manager, engine, sends, child };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('RdpManager: COM-хост встраивание', () => {
  it('COM-хост: spawn → HWND из stdout → embed → позиционирование', async () => {
    const { manager, engine, child } = makeManager({});
    const res = await manager.launch(rdpHost(), null, 's1');
    expect(res).toEqual({ ok: true });

    await sleep(20);
    // HWND пришёл из comSpawn — embed вызывается сразу, без findWindowByPid
    expect(engine.calls).toContain('hide:777');
    expect(engine.calls).toContain('embed:777->111');

    // прямоугольник от рендерера → setRect + show
    manager.setRect('s1', RECT);
    expect(engine.calls).toContain('rect:777:10,20,800,500');
    expect(engine.calls).toContain('show:777');
  });

  it('COM-хост не запускается → rdp:exited с ошибкой', async () => {
    const sends: { channel: string; payload: unknown }[] = [];
    const manager = new RdpManager({
      sealer: {} as never,
      send: (c, p) => sends.push({ channel: c, payload: p }),
      getParentHwnd: () => 111n,
      engine: new FakeEngine(),
      comSpawn: async () => ({ ok: false, error: 'exe not found', cleanup: () => undefined })
    });
    const res = await manager.launch(rdpHost(), null, 's1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('exe not found');
    const exited = sends.find((s) => s.channel === 'rdp:exited');
    expect(exited).toBeDefined();
  });

  it('fullscreen-профиль встраивается во вкладку', async () => {
    const { manager, engine } = makeManager({});
    const res = await manager.launch(
      rdpHost({ rdp: { domain: '', screenMode: 'fullscreen', width: 1280, height: 800, multiMonitor: false, promptForCreds: false } }),
      null,
      's1'
    );
    expect(res).toEqual({ ok: true });
    await sleep(20);
    expect(engine.calls).toContain('embed:777->111');
    expect(manager.isEmbedded('s1')).toBe(true);
  });

  it('stop закрывает окно (WM_CLOSE) и убивает процесс', async () => {
    const { manager, engine, child, sends } = makeManager({});
    await manager.launch(rdpHost(), null, 's1');
    await sleep(20);
    expect(engine.calls).toContain('embed:777->111');

    manager.stop('s1');
    expect(engine.calls).toContain('close:777');
    expect(engine.calls).toContain('hide:777');
    // закрытие вкладки не шлёт rdp:exited
    expect(sends).toHaveLength(0);
  });

  it('activate показывает активную и прячет остальные', async () => {
    const engine = new FakeEngine();
    const children = [new FakeChild(4242), new FakeChild(4243)];
    const comSpawns = children.map((c, i) => ({
      ok: true as const,
      child: c,
      hwnd: BigInt(i + 1),
      cleanup: () => undefined
    }));
    let spawnIdx = 0;
    const manager = new RdpManager({
      sealer: {} as never,
      send: () => undefined,
      getParentHwnd: () => 111n,
      engine,
      comSpawn: async () => comSpawns[spawnIdx++],
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
    const { manager, engine } = makeManager({});
    await manager.launch(rdpHost(), null, 's1');
    await sleep(20);
    manager.setRect('s1', RECT);
    expect(engine.calls).toContain('show:777');

    manager.setOverlay(true);
    expect(engine.calls).toContain('hide:777');
    manager.setOverlay(false);
    expect(engine.calls).toContain('show:777');
  });

  it('выход COM-хоста без закрытия вкладки шлёт rdp:exited', async () => {
    const { manager, child, sends } = makeManager({});
    await manager.launch(rdpHost(), null, 's1');
    await sleep(20);
    child.emit('exit', 0);
    await sleep(5);
    const exited = sends.find((s) => s.channel === 'rdp:exited');
    expect(exited).toBeDefined();
    expect((exited?.payload as { code: number }).code).toBe(0);
  });

  it('resize-команда отправляется в stdin COM-хоста с debounce', async () => {
    const { manager, child } = makeManager({ watchdogInterval: 100 });
    await manager.launch(rdpHost(), null, 's1');
    await sleep(20);
    // первый rect — отправляет resize после debounce
    manager.setRect('s1', RESIZE_RECT);
    // сразу меняем ещё раз — не должно слать до debounce
    manager.setRect('s1', { x: 0, y: 0, width: 1280, height: 720 });
    await sleep(50);
    // debounce мог ещё не сработать (300ms), проверяем что не раньше
    expect(child.stdinWrites.filter((w) => w.startsWith('resize')).length).toBeLessThanOrEqual(1);
    // ждём debounce
    await sleep(350);
    const resizeCmds = child.stdinWrites.filter((w) => w.startsWith('resize'));
    expect(resizeCmds.length).toBeGreaterThanOrEqual(1);
    expect(resizeCmds[resizeCmds.length - 1]).toContain('1280');
    expect(resizeCmds[resizeCmds.length - 1]).toContain('720');
  });

  it('killChild отправляет quit в stdin', async () => {
    const { manager, child } = makeManager({ killGraceMs: 0 });
    await manager.launch(rdpHost(), null, 's1');
    await sleep(20);
    manager.stop('s1');
    await sleep(20);
    expect(child.stdinWrites.some((w) => w.includes('quit'))).toBe(true);
  });
});
