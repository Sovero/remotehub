/**
 * Тесты IronGateway — локального RDCleanPath-моста для iron-remote-desktop.
 *
 * Покрывают:
 *  - DER-кодек RDCleanPath PDU (round-trip всех полей);
 *  - полный хендшейк с фейковым RDP-сервером (Request → CC → Response → сырой пайп);
 *  - отрицательное согласование (X.224 reject пробрасывается клиенту);
 *  - отказ TCP (маппится в WSA-код ошибки).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import { WebSocket } from 'ws';
import {
  IronGateway,
  RDCLEANPATH_VERSION,
  NEGOTIATION_ERROR_CODE,
  decodePdu,
  encodeError,
  encodeRequest,
  encodeResponse
} from '../src/main/rdp/iron-gateway';

const X224_CR = Buffer.from([
  0x03, 0x00, 0x00, 0x13, // TPKT: len 19
  0x0e, // LI
  0xe0, // Connection Request
  0x00, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x08, 0x00, 0x03, 0x00, 0x00, 0x00
]);
const X224_CC = Buffer.from([
  0x03, 0x00, 0x00, 0x13, // TPKT: len 19
  0x0e, // LI
  0xd0, // Connection Confirm
  0x00, 0x00, 0x12, 0x34, 0x00,
  0x02, 0x1f, 0x08, 0x00, 0x08, 0x00, 0x00, 0x00
]);

interface FakeServerOpts {
  /** Байты ответа на первый X.224 PDU каждого соединения. */
  x224Reply: Buffer;
  /** Что записать в сокет сразу после X.224-ответа (проверка пайпа сервер→клиент). */
  afterReply?: Buffer;
}

/** Фейковый «RDP-сервер»: отвечает фиксированным X.224 и опционально пишет данные. */
async function startFakeRdpServer(opts: FakeServerOpts): Promise<{
  port: number;
  receivedFromClients: () => Buffer[];
  close: () => Promise<void>;
}> {
  const received: Buffer[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    let buf = Buffer.alloc(0);
    let replied = false;
    sock.on('data', (chunk: Buffer) => {
      if (!replied) {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length < opts.x224Reply.length) return;
        replied = true;
        sock.write(opts.x224Reply);
        if (opts.afterReply) {
          setTimeout(() => sock.write(opts.afterReply!), 30);
        }
      } else {
        received.push(Buffer.from(chunk));
      }
    });
    sock.on('error', () => {
      /* тестовый сервер игнорирует обрывы пробных соединений */
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as net.AddressInfo;
  return {
    port: addr.port,
    receivedFromClients: () => received.map((b) => Buffer.from(b)),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const c of sockets) c.destroy();
      })
  };
}

function wsConnect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Аналог toBuf из шлюза: шим Buffer под vitest не имеет статического isArray. */
function wsToBuf(data: unknown): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  const u = data as Uint8Array;
  if (u && u.buffer) return Buffer.from(u.buffer as ArrayBuffer, u.byteOffset, u.byteLength);
  return Buffer.from(data as ArrayBuffer);
}

function nextWsMessage(ws: WebSocket, timeoutMs = 6000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws: не дождались сообщения')), timeoutMs);
    const onMsg = (data: unknown): void => {
      clearTimeout(timer);
      cleanup();
      resolve(wsToBuf(data));
    };
    const onClose = (): void => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('ws: соединение закрыто'));
    };
    const cleanup = (): void => {
      ws.off('message', onMsg);
      ws.off('close', onClose);
    };
    ws.on('message', onMsg);
    ws.on('close', onClose);
  });
}

describe('DER-кодек RDCleanPath', () => {
  it('Request round-trip: version/destination/proxy_auth/x224', () => {
    const pdu = encodeRequest('win-host:3389', 'token-poc', X224_CR);
    const f = decodePdu(pdu);
    expect(f.version).toBe(RDCLEANPATH_VERSION);
    expect(f.destination).toBe('win-host:3389');
    expect(f.proxyAuth).toBe('token-poc');
    expect(f.x224?.equals(X224_CR)).toBe(true);
  });

  it('Response round-trip: cc + цепочка сертификатов + адрес', () => {
    const cert1 = Buffer.from([1, 2, 3, 4]);
    const cert2 = Buffer.from([5, 6, 7, 8, 9]);
    const pdu = encodeResponse(X224_CC, [cert1, cert2], '10.0.0.5');
    const f = decodePdu(pdu);
    expect(f.version).toBe(RDCLEANPATH_VERSION);
    expect(f.serverAddr).toBe('10.0.0.5');
    expect(f.certChain).toHaveLength(2);
    expect(f.certChain![0].equals(cert1)).toBe(true);
    expect(f.certChain![1].equals(cert2)).toBe(true);
    expect(f.x224?.equals(X224_CC)).toBe(true);
  });

  it('Ошибка: коды general/negotiation/http/wsa/tls и вложенный x224', () => {
    const g = decodePdu(encodeError({ errorCode: 1, wsaErrorCode: 10061 }));
    expect(g.errorCode).toBe(1);
    expect(g.wsaErrorCode).toBe(10061);

    const n = decodePdu(encodeError({ errorCode: NEGOTIATION_ERROR_CODE, negotiationX224: X224_CC }));
    expect(n.errorCode).toBe(NEGOTIATION_ERROR_CODE);
    expect(n.x224?.equals(X224_CC)).toBe(true);

    const h = decodePdu(encodeError({ errorCode: 1, httpStatusCode: 403 }));
    expect(h.httpStatusCode).toBe(403);
  });

  it('Длинные поля (>127 байт) кодируются long-form длиной', () => {
    const longCert = Buffer.alloc(300, 0xab);
    const f = decodePdu(encodeResponse(X224_CC, [longCert], 'host'));
    expect(f.certChain![0].equals(longCert)).toBe(true);
  });
});

/**
 * Очередь сообщений ws: ловит ВСЕ сообщения с момента создания,
 * не теряя те, что пришли между двумя await (frames могут прийти подряд одним потоком).
 */
function wsMessageQueue(ws: WebSocket): { next: (timeoutMs?: number) => Promise<Buffer> } {
  const queue: Buffer[] = [];
  interface Waiter { resolve: (b: Buffer) => void; timer: NodeJS.Timeout }
  const waiters: Waiter[] = [];
  ws.on('message', (data) => {
    const buf = wsToBuf(data);
    const w = waiters.shift();
    if (w) {
      clearTimeout(w.timer);
      w.resolve(buf);
    } else {
      queue.push(buf);
    }
  });
  return {
    next(timeoutMs = 6000): Promise<Buffer> {
      const buffered = queue.shift();
      if (buffered) return Promise.resolve(buffered);
      return new Promise((resolve, reject) => {
        const w: Waiter = {
          resolve,
          timer: setTimeout(() => {
            const i = waiters.indexOf(w);
            if (i >= 0) waiters.splice(i, 1);
            reject(new Error('ws: не дождались сообщения'));
          }, timeoutMs)
        };
        waiters.push(w);
      });
    }
  };
}

describe('IronGateway — хендшейк и туннель', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()!();
    }
  }, 15000);

  async function makeGateway(fakePort: number): Promise<{ gw: IronGateway; states: string[] }> {
    const states: string[] = [];
    const gw = new IronGateway({
      sessionId: 'test',
      host: '127.0.0.1',
      port: fakePort,
      connectTimeoutMs: 3000,
      x224TimeoutMs: 3000,
      probeTimeoutMs: 200, // фейковый сервер не умеет TLS — проба истечёт и вернёт []
      onState: (_id, s) => states.push(s.phase)
    });
    await gw.start();
    cleanups.push(() => gw.stop());
    return { gw, states };
  }

  it('полный цикл: Request → Response(cc) → двунаправленный сырой пайп', async () => {
    const fake = await startFakeRdpServer({
      x224Reply: X224_CC,
      afterReply: Buffer.from('SRV-DATA')
    });
    cleanups.push(fake.close);
    const { gw, states } = await makeGateway(fake.port);

    const ws = await wsConnect(gw.actualPort);
    const msgs = wsMessageQueue(ws);
    ws.send(encodeRequest('any', 'auth', X224_CR));

    const resp = decodePdu(await msgs.next());
    expect(resp.version).toBe(RDCLEANPATH_VERSION);
    expect(resp.errorCode).toBeUndefined();
    expect(resp.x224?.equals(X224_CC)).toBe(true); // подтверждение проброшено как есть

    // Сервер → клиент сквозь туннель.
    const srvData = await msgs.next();
    expect(srvData.toString()).toBe('SRV-DATA');

    // Клиент → сервер сквозь туннель.
    ws.send(Buffer.from('CLIENT-DATA'));
    await new Promise((r) => setTimeout(r, 150));
    const got = fake.receivedFromClients().join('|');
    expect(got).toContain('CLIENT-DATA');

    expect(states).toContain('connected');
    ws.close();
  }, 15000);

  it('отрицательное согласование приходит клиенту как negotiation error c x224 сервера', async () => {
    const rejectBytes = Buffer.from([3, 0, 0, 0x0b, 0x06, 0xd1, 0x00, 0x00, 0x00, 0x02, 0x01]);
    const fake = await startFakeRdpServer({ x224Reply: rejectBytes });
    cleanups.push(fake.close);
    const { gw } = await makeGateway(fake.port);

    const ws = await wsConnect(gw.actualPort);
    ws.send(encodeRequest('any', 'auth', X224_CR));
    const f = decodePdu(await nextWsMessage(ws));
    expect(f.errorCode).toBe(NEGOTIATION_ERROR_CODE);
    expect(f.x224?.equals(rejectBytes)).toBe(true);
    ws.close();
  }, 15000);

  it('отказ TCP маппится в WSA ECONNREFUSED', async () => {
    const dead = await startFakeRdpServer({ x224Reply: X224_CC });
    const deadPort = dead.port;
    await dead.close(); // порт освободился — никто не слушает

    const gw = new IronGateway({
      sessionId: 'test-refused',
      host: '127.0.0.1',
      port: deadPort,
      connectTimeoutMs: 3000
    });
    await gw.start();
    cleanups.push(() => gw.stop());

    const ws = await wsConnect(gw.actualPort);
    ws.send(encodeRequest('any', 'auth', X224_CR));
    const f = decodePdu(await nextWsMessage(ws));
    expect(f.errorCode).toBe(1);
    expect(f.wsaErrorCode).toBe(10061);
    ws.close();
  }, 15000);
});
