/**
 * Тесты трёх быстрых фиксов из docs/rdp-engine-risk-report.md:
 *  - R7: точная копия пиксельного буфера в горячем пути rdpjs:bitmap;
 *  - R8: одноразовый токен RDCleanPath-моста (upgrade + proxy_auth Request PDU);
 *  - R2: гарантированная уборка cmdkey-записи при closeAll/before-quit.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { IronGateway, decodePdu, encodeRequest, GENERAL_ERROR_CODE, RDCLEANPATH_VERSION } from '../src/main/rdp/iron-gateway';
import { cmdkeyTargetFor, purgeCmdkeyCredential } from '../src/main/rdp/com-launcher';
import { RdpManager } from '../src/main/rdp/manager';
import type { Host } from '../src/shared/types';

// ---------------- R7: точная копия кадра ----------------

describe('R7: пейлоад rdpjs:bitmap — точная копия буфера', () => {
  it('Buffer.from(вид-подмассив) копирует ровно диапазон вида, а не весь буфер', () => {
    // Инвариант, на котором держит фикс в main/index.ts: bitmap.data у
    // node-rdpjs может быть subarray-видом над большим буфером распаковщика,
    // и structured clone сериализует весь referenced-буфер. Buffer.from(view)
    // снимает точную копию диапазона — и размер пейлоада, и байты совпадают.
    const backing = new Uint8Array(64);
    for (let i = 0; i < backing.length; i++) backing[i] = i;
    const view = backing.subarray(16, 48);

    const copy = Buffer.from(view);

    expect(copy.byteLength).toBe(32); // не 64 — «хвост» буфера не уехал в IPC
    expect(Array.from(copy)).toEqual(Array.from(view));
    // Копия, а не вид: изменение оригинала не меняет пейлоад.
    backing[20] = 0xff;
    expect(copy[4]).toBe(20);
  });
});

// ---------------- R8: токен моста ----------------

const X224_CR = Buffer.from([
  0x03, 0x00, 0x00, 0x13, 0x0e, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00, 0x03, 0x00, 0x00, 0x00
]);
const X224_CC = Buffer.from([
  0x03, 0x00, 0x00, 0x13, 0x0e, 0xd0, 0x00, 0x00, 0x12, 0x34, 0x00, 0x02, 0x1f, 0x08, 0x00, 0x08, 0x00, 0x00, 0x00
]);

/** Фейковый RDP-сервер: отвечает фиксированным X.224 CC. */
async function startFakeRdpServer(): Promise<number> {
  const net = await import('node:net');
  const server = net.createServer((sock) => {
    sock.once('data', (chunk: Buffer) => {
      if (chunk.length >= X224_CC.length) sock.write(X224_CC);
    });
    sock.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as net.AddressInfo).port;
}

function nextMessage(ws: WebSocket, timeoutMs = 6000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws: не дождались сообщения')), timeoutMs);
    ws.once('message', (d) => {
      clearTimeout(t);
      const u = d as Uint8Array;
      resolve(u && u.buffer ? Buffer.from(u.buffer, u.byteOffset, u.byteLength) : Buffer.from(d as ArrayBuffer));
    });
    ws.once('close', () => {
      clearTimeout(t);
      reject(new Error('ws: закрыто'));
    });
  });
}

/** Ожидаем отказ upgrade (не 101): ws-клиент эмитит ошибку с HTTP-статусом. */
function expectUpgradeFailure(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ожидали отказ upgrade, но соединение открылось')), 6000);
    ws.once('open', () => {
      clearTimeout(t);
      reject(new Error('ожидали отказ upgrade, но рукопожатие прошло'));
    });
    ws.once('error', (e) => {
      clearTimeout(t);
      resolve((e as Error).message);
    });
  });
}

describe('R8: IronGateway — доступ только по токену сессии', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  }, 15000);

  async function makeGateway(fakePort: number): Promise<IronGateway> {
    const gw = new IronGateway({
      sessionId: 'tok',
      host: '127.0.0.1',
      port: fakePort,
      connectTimeoutMs: 3000,
      x224TimeoutMs: 3000,
      probeTimeoutMs: 200
    });
    await gw.start();
    cleanups.push(() => gw.stop());
    return gw;
  }

  function openWs(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  it('buildWsUrl содержит токен в query', async () => {
    const fakePort = await startFakeRdpServer();
    cleanups.push(async () => undefined); // заглушка симметрии
    const gw = await makeGateway(fakePort);
    const url = gw.buildWsUrl();
    expect(url).toBe(`ws://127.0.0.1:${gw.actualPort}/?token=${gw.authToken}`);
    expect(gw.authToken).toMatch(/^[0-9a-f]{32}$/); // 128 бит hex
  });

  it('upgrade без токена и с неверным токеном отклоняется (401)', async () => {
    const fakePort = await startFakeRdpServer();
    const gw = await makeGateway(fakePort);

    const noToken = new WebSocket(`ws://127.0.0.1:${gw.actualPort}`);
    expect(await expectUpgradeFailure(noToken)).toContain('401');

    const badToken = new WebSocket(`ws://127.0.0.1:${gw.actualPort}/?token=deadbeef`);
    expect(await expectUpgradeFailure(badToken)).toContain('401');
  });

  it('валидный токен в query + тот же в proxy_auth Request PDU → туннель поднят', async () => {
    const fakePort = await startFakeRdpServer();
    const gw = await makeGateway(fakePort);

    const ws = await openWs(gw.buildWsUrl());
    ws.send(encodeRequest('any', gw.authToken, X224_CR));
    const resp = decodePdu(await nextMessage(ws));
    expect(resp.version).toBe(RDCLEANPATH_VERSION);
    expect(resp.errorCode).toBeUndefined();
    expect(resp.x224?.equals(X224_CC)).toBe(true);
    ws.close();
  });

  it('валидный upgrade, но чужой proxy_auth в Request PDU → ошибка GENERAL', async () => {
    const fakePort = await startFakeRdpServer();
    const gw = await makeGateway(fakePort);

    const ws = await openWs(gw.buildWsUrl());
    ws.send(encodeRequest('any', 'stale-token-from-other-session', X224_CR));
    const resp = decodePdu(await nextMessage(ws));
    expect(resp.errorCode).toBe(GENERAL_ERROR_CODE);
    ws.close();
  });
});

// ---------------- R2: уборка cmdkey ----------------

const execFileMock = vi.hoisted(() => vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null) => void) => cb(null)));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: execFileMock,
    default: { ...actual, execFile: execFileMock }
  };
});

describe('R2: гарантированная уборка cmdkey', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('целевой ключ cmdkey — TERMSRV/<host>', () => {
    expect(cmdkeyTargetFor('win-host01')).toBe('TERMSRV/win-host01');
  });

  it('purgeCmdkeyCredential вызывает cmdkey /delete с целевым ключом', () => {
    purgeCmdkeyCredential('legacy-host');
    expect(execFileMock).toHaveBeenCalledWith('cmdkey', ['/delete:TERMSRV/legacy-host'], { windowsHide: true }, expect.any(Function));
  });

  it('closeAll сносит cmdkey-запись даже при аварийном пути (без cleanup COM-хоста)', async () => {
    // Минимальный фейк COM-хоста: EventEmitters с stdin/kill.
    const makeFakeChild = (): ChildProcessLike => {
      const c = new EventEmitter() as ChildProcessLike;
      c.stdin = { write: vi.fn() } as unknown as ChildProcessLike['stdin'];
      c.kill = vi.fn();
      return c;
    };

    let spawned: ChildProcessLike | null = null;
    const comSpawn = vi.fn(async () => {
      spawned = makeFakeChild();
      return { ok: true, child: spawned, hwnd: BigInt('0x1234'), cleanup: () => undefined };
    });

    const manager = new RdpManager({
      sealer: { available: () => true, seal: (b: Buffer) => b, unseal: (b: Buffer) => b.toString() },
      send: () => undefined,
      getParentHwnd: () => BigInt('0xff00'),
      getParentOrigin: () => ({ x: 0, y: 0 }),
      comSpawn: comSpawn as unknown as ConstructorParameters<typeof RdpManager>[0]['comSpawn'],
      watchdogInterval: 60000
    });

    const host = {
      id: 'h1', kind: 'host', name: 'legacy', protocol: 'rdp',
      host: 'purge-target', port: 3389, username: '', credentialId: null,
      tags: [], notes: '',
      ssh: {} as Host['ssh'], vnc: {} as Host['vnc'],
      rdp: { domain: '', width: 1024, height: 768, promptForCreds: true },
      lastConnectedAt: null
    } as unknown as Host;

    await manager.launch(host, null, 'sess-1');
    // Штатная cleanup() фейка пуста — запись могла бы остаться навсегда при
    // аварийном завершении. closeAll обязан снести её независимо от процесса.
    manager.closeAll();

    expect(execFileMock).toHaveBeenCalledWith('cmdkey', ['/delete:TERMSRV/purge-target'], { windowsHide: true }, expect.any(Function));
    expect(spawned!.kill).toHaveBeenCalled();
  });
});

interface ChildProcessLike extends EventEmitter {
  stdin: { write: (s: string) => void } | null;
  kill: () => void;
}
