/**
 * Локальный мост RDCleanPath для @devolutions/iron-remote-desktop.
 *
 * Web-компонент в renderer умеет подключаться только через WebSocket-прокси,
 * говорящий на протоколе RDCleanPath (DER-кодированный ASN.1 поверх WS-фреймов).
 * Этот класс поднимает одноразовый ws-сервер на 127.0.0.1 и играет роль прокси:
 *
 *   1. Клиент шлёт Request PDU: {version, destination, proxy_auth, x224_connection_pdu}
 *   2. Мост открывает TCP к RDP-хосту, пересылает X.224 Connection Request, ждёт Confirm.
 *   3. Отдельным «пробным» соединением забирает TLS-цепочку сертификата сервера
 *      (публичные данные — валидация у клиента всё равно будет своя, end-to-end).
 *   4. Шлёт Response PDU: {x224_confirm, server_cert_chain, server_addr}.
 *   5. Дальше — сырой пайп WS ↔ TCP: CredSSP/TLS клиент проходит сам сквозь туннель.
 *
 * Формат PDU — из crates/ironrdp-rdcleanpath (tag_mode = EXPLICIT):
 *   SEQ {
 *     [0] version INTEGER (3390)
 *     [1] error SEQUENCE{ [0] code, [1] http, [2] wsa, [3] tls-alert } (optional)
 *     [2] destination UTF8String        (optional)
 *     [3] proxy_auth UTF8String         (optional)
 *     [4] server_auth UTF8String        (optional)
 *     [5] preconnection_blob UTF8String (optional)
 *     [6] x224 OCTET STRING             (optional)
 *     [7] cert_chain SEQUENCE OF OCTET STRING (optional)
 *     [9] server_addr UTF8String        (optional)
 *   }
 */
import * as net from 'node:net';
import * as tls from 'node:tls';
import { WebSocketServer, type WebSocket } from 'ws';

export const RDCLEANPATH_VERSION = 3390; // BASE_VERSION(3389) + 1
export const GENERAL_ERROR_CODE = 1;
export const NEGOTIATION_ERROR_CODE = 2;

/** WSA-код для обычных ошибок connect (упрощённая карта). */
function wsaCodeFor(err: NodeJS.ErrnoException | undefined): number | null {
  switch (err?.code) {
    case 'ECONNREFUSED': return 10061;
    case 'ECONNRESET': return 10054;
    case 'ETIMEDOUT': return 10060;
    case 'ENOTFOUND':
    case 'EAI_AGAIN': return 11001;
    case 'EACCES': return 10013;
    case 'ENETUNREACH': return 10051;
    default: return null;
  }
}

// ---------------- Минимальный DER ----------------

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n <= 0xff) return Buffer.from([0x81, n]);
  return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff]);
}

function derTlv(tag: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(payload.length), payload]);
}

function derInt(value: number): Buffer {
  if (value === 0) return derTlv(0x02, Buffer.from([0]));
  const bytes: number[] = [];
  let v = value;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return derTlv(0x02, Buffer.from(bytes));
}

function derUtf8(s: string): Buffer {
  return derTlv(0x0c, Buffer.from(s, 'utf8'));
}

function ctxWrap(tagNo: number, inner: Buffer): Buffer {
  return derTlv(0xa0 | tagNo, inner);
}

/** Декодирует TLV из buf по смещению off. Возвращает [tag, content, nextOffset]. */
function readTlv(buf: Buffer, off: number): [number, Buffer, number] {
  if (off + 2 > buf.length) throw new Error('DER: обрыв перед заголовком');
  const tag = buf[off];
  let lenByte = buf[off + 1];
  let len: number;
  let hdr: number;
  if ((lenByte & 0x80) === 0) {
    len = lenByte;
    hdr = 2;
  } else {
    const count = lenByte & 0x7f;
    if (count === 0 || count > 3) throw new Error(`DER: неподдерживаемая длина (${count})`);
    if (off + 2 + count > buf.length) throw new Error('DER: обрыв в длине');
    len = 0;
    for (let i = 0; i < count; i++) len = len * 256 + buf[off + 2 + i];
    hdr = 2 + count;
  }
  const start = off + hdr;
  if (start + len > buf.length) throw new Error('DER: обрыв в содержимом');
  return [tag, buf.subarray(start, start + len), start + len];
}

/** Поля декодированного PDU. */
export interface RdcleanPathFields {
  version?: number;
  errorCode?: number;
  httpStatusCode?: number;
  wsaErrorCode?: number;
  tlsAlertCode?: number;
  destination?: string;
  proxyAuth?: string;
  preconnectionBlob?: string;
  x224?: Buffer;
  certChain?: Buffer[];
  serverAddr?: string;
}

/** Декодирует RDCleanPath PDU (только поля, нужные мосту). */
export function decodePdu(buf: Buffer): RdcleanPathFields {
  const out: RdcleanPathFields = {};
  const [seqTag, seqBody] = readTlv(buf, 0);
  if (seqTag !== 0x30) throw new Error(`RDCleanPath: ожидался SEQUENCE, получен 0x${seqTag.toString(16)}`);
  let off = 0;
  while (off < seqBody.length) {
    const [ctxTag, ctxBody, next] = readTlv(seqBody, off);
    off = next;
    const tagNo = ctxTag & 0x1f;
    const [, inner] = readTlv(ctxBody, 0);
    switch (tagNo) {
      case 0:
        out.version = inner.readUIntBE(0, inner.length);
        break;
      case 1: {
        // error: SEQUENCE с контекстными полями
        let eoff = 0;
        while (eoff < inner.length) {
          const [eCtxTag, eBody, eNext] = readTlv(inner, eoff);
          eoff = eNext;
          const [, eVal] = readTlv(eBody, 0);
          const num = eVal.length ? eVal.readUIntBE(0, eVal.length) : 0;
          if ((eCtxTag & 0x1f) === 0) out.errorCode = num;
          else if ((eCtxTag & 0x1f) === 1) out.httpStatusCode = num;
          else if ((eCtxTag & 0x1f) === 2) out.wsaErrorCode = num;
          else if ((eCtxTag & 0x1f) === 3) out.tlsAlertCode = num;
        }
        break;
      }
      case 2: out.destination = inner.toString('utf8'); break;
      case 3: out.proxyAuth = inner.toString('utf8'); break;
      case 5: out.preconnectionBlob = inner.toString('utf8'); break;
      case 6: out.x224 = Buffer.from(inner); break;
      case 7: {
        const certs: Buffer[] = [];
        let coff = 0;
        while (coff < inner.length) {
          const [octTag, octBody, cnext] = readTlv(inner, coff);
          coff = cnext;
          if (octTag === 0x04) certs.push(Buffer.from(octBody));
        }
        out.certChain = certs;
        break;
      }
      case 9: out.serverAddr = inner.toString('utf8'); break;
      default: break; // неизвестные поля игнорируем (совместимость вперёд)
    }
  }
  return out;
}

/** Request клиента → прокси. */
export function encodeRequest(destination: string, proxyAuth: string, x224: Buffer): Buffer {
  const parts: Buffer[] = [
    ctxWrap(0, derInt(RDCLEANPATH_VERSION)),
    ctxWrap(2, derUtf8(destination)),
    ctxWrap(3, derUtf8(proxyAuth)),
    ctxWrap(6, derTlv(0x04, x224))
  ];
  return derTlv(0x30, Buffer.concat(parts));
}

/** Response прокси → клиент (успешное согласование). */
export function encodeResponse(x224Confirm: Buffer, certChain: Buffer[], serverAddr: string): Buffer {
  const chainSeq = derTlv(
    0x30,
    Buffer.concat(certChain.map((c) => derTlv(0x04, c)))
  );
  const parts: Buffer[] = [
    ctxWrap(0, derInt(RDCLEANPATH_VERSION)),
    ctxWrap(6, derTlv(0x04, x224Confirm)),
    ctxWrap(7, chainSeq),
    ctxWrap(9, derUtf8(serverAddr))
  ];
  return derTlv(0x30, Buffer.concat(parts));
}

/** Ошибка прокси → клиент. */
export function encodeError(opts: {
  errorCode?: number;
  httpStatusCode?: number;
  wsaErrorCode?: number;
  tlsAlertCode?: number;
  negotiationX224?: Buffer;
}): Buffer {
  const errInner: Buffer[] = [ctxWrap(0, derInt(opts.errorCode ?? GENERAL_ERROR_CODE))];
  if (opts.httpStatusCode != null) errInner.push(ctxWrap(1, derInt(opts.httpStatusCode)));
  if (opts.wsaErrorCode != null) errInner.push(ctxWrap(2, derInt(opts.wsaErrorCode)));
  if (opts.tlsAlertCode != null) errInner.push(ctxWrap(3, Buffer.from([opts.tlsAlertCode])));
  const errSeq = derTlv(0x30, Buffer.concat(errInner));
  const parts: Buffer[] = [ctxWrap(0, derInt(RDCLEANPATH_VERSION)), ctxWrap(1, errSeq)];
  if (opts.negotiationX224) parts.push(ctxWrap(6, derTlv(0x04, opts.negotiationX224)));
  return derTlv(0x30, Buffer.concat(parts));
}

// ---------------- Утилиты ----------------

/** Приводит полезную нагрузку ws-сообщения к Buffer без опоры на статические методы шима. */
function toBuf(data: unknown): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data.map((d) => toBuf(d)));
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  const u = data as Uint8Array;
  if (u && u.buffer) {
    return Buffer.from(u.buffer as ArrayBuffer, u.byteOffset, u.byteLength);
  }
  return Buffer.from(data as ArrayBuffer);
}

// ---------------- TPKT/X.224 ----------------

/**
 * Непрерывный канал поверх TCP-сокета: ОДИН постоянный 'data'-слушатель на всё
 * время жизни соединения. Байты, пришедшие раньше, чем их запросили, не теряются,
 * а остаются в очереди; остатки пакета после точного чтения — тоже.
 */
class ChannelBuffer {
  private buf = Buffer.alloc(0);
  private waiter: (() => void) | null = null;
  private closed = false;
  private tunnelForward: ((b: Buffer) => void) | null = null;

  constructor(private readonly sock: net.Socket) {
    sock.on('data', (chunk: Buffer) => {
      if (this.tunnelForward) {
        this.tunnelForward(Buffer.from(chunk));
        return;
      }
      this.buf = Buffer.concat([this.buf, chunk]);
      const w = this.waiter;
      this.waiter = null;
      w?.();
    });
    const die = (): void => {
      this.closed = true;
      const w = this.waiter;
      this.waiter = null;
      w?.();
    };
    sock.once('close', die);
    sock.once('error', die);
  }

  /** Читает ровно n байт (ждёт недостающие). Остаток остаётся в очереди. */
  async readExact(n: number, timeoutMs: number): Promise<Buffer> {
    const take = (): Buffer | null => {
      if (this.buf.length < n) return null;
      const out = Buffer.from(this.buf.subarray(0, n));
      this.buf = Buffer.from(this.buf.subarray(n));
      return out;
    };
    const immediate = take();
    if (immediate) return immediate;
    if (this.closed) throw new Error('соединение закрыто до получения данных');
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error(`чтение ${n} байт: таймаут ${timeoutMs}мс`));
      }, timeoutMs);
      this.waiter = () => {
        clearTimeout(timer);
        const out = take();
        if (out) resolve(out);
        else reject(new Error(this.closed ? 'соединение закрыто' : 'недостаточно байт'));
      };
    });
  }

  /** Режим туннеля: все накопленные и будущие байты уходят в forward. */
  startTunneling(forward: (b: Buffer) => void): void {
    this.tunnelForward = forward;
    while (this.buf.length > 0) {
      forward(Buffer.from(this.buf));
      this.buf = Buffer.alloc(0);
    }
  }
}

/** Первый X.224 PDU сервера (TPKT-обёртка): confirm=true при Connection Confirm (0xD0). */
async function readX224(
  chan: ChannelBuffer,
  timeoutMs: number
): Promise<{ confirm: boolean; bytes: Buffer }> {
  const head = await chan.readExact(4, timeoutMs);
  if (head[0] !== 3 || head[1] !== 0) {
    throw new Error('X.224: это не TPKT-поток (сервер не RDP?)');
  }
  const total = head.readUInt16BE(2);
  if (total < 11) throw new Error(`X.224: некорректная длина TPKT (${total})`);
  const rest = total > 4 ? await chan.readExact(total - 4, timeoutMs) : Buffer.alloc(0);
  const bytes = Buffer.concat([head, rest]);
  return { confirm: bytes[5] === 0xd0, bytes };
}

// ---------------- Шлюз ----------------

export interface IronGatewayState {
  phase: 'connecting' | 'connected' | 'error' | 'closed';
  message?: string;
}

export interface IronGatewayOptions {
  sessionId: string;
  host: string;
  port: number;
  /** Таймауты (переопределяются в тестах). */
  connectTimeoutMs?: number;
  x224TimeoutMs?: number;
  probeTimeoutMs?: number;
  onState?: (sessionId: string, state: IronGatewayState) => void;
}

interface PendingConn {
  ws: WebSocket;
}

/**
 * Один экземпляр = одна RDP-сессия. Слушает только 127.0.0.1.
 */
export class IronGateway {
  private readonly opts: Required<Pick<IronGatewayOptions, 'connectTimeoutMs' | 'x224TimeoutMs' | 'probeTimeoutMs'>> &
    IronGatewayOptions;
  private wss: WebSocketServer | null = null;
  private server: net.Server | null = null;
  private relay: net.Socket | null = null;
  private probe: net.Socket | null = null;
  private pending: PendingConn | null = null;
  private closed = false;

  public actualPort = 0;

  constructor(options: IronGatewayOptions) {
    this.opts = {
      connectTimeoutMs: 8000,
      x224TimeoutMs: 8000,
      probeTimeoutMs: 6000,
      ...options
    };
  }

  /** Поднимает ws-сервер на случайном порту 127.0.0.1. */
  async start(): Promise<number> {
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve, reject) => {
      this.wss!.once('listening', () => resolve());
      this.wss!.once('error', (e) => reject(e));
    });
    this.server = (this.wss as unknown as { _server: net.Server })._server;
    this.actualPort = (this.server?.address() as net.AddressInfo).port;
    this.wss.on('connection', (ws) => {
      this.handleConnection(ws).catch((e: unknown) => {
        // Диагностика нештатных путей: попадает в лог main-процесса.
        console.error('[iron-gateway] handleConnection crashed:', e);
        this.fail((e as Error)?.message ?? 'internal error');
      });
    });
    this.wss.on('error', () => {
      /* слушающий сокет: ошибки отдельных соединений обрабатываются в handleConnection */
    });
    return this.actualPort;
  }

  private report(state: IronGatewayState): void {
    this.opts.onState?.(this.opts.sessionId, state);
  }

  private sendWs(ws: WebSocket, data: Buffer): boolean {
    if (ws.readyState !== ws.OPEN) return false;
    ws.send(data);
    return true;
  }

  private tcpConnect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: this.opts.host, port: this.opts.port });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`TCP: таймаут подключения к ${this.opts.host}:${this.opts.port}`));
      }, this.opts.connectTimeoutMs);
      sock.once('connect', () => {
        clearTimeout(timer);
        resolve(sock);
      });
      sock.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  /**
   * Пробное соединение ради TLS-цепочки сервера: X.224 → CC → TLS-upgrade → peer certs.
   * Ошибка пробы не фатальна: отдаём пустую цепочку, клиент провалидирует сама.
   */
  private async probeCertificates(x224Req: Buffer): Promise<Buffer[]> {
    const probe = await this.tcpConnect();
    this.probe = probe;
    try {
      const chan = new ChannelBuffer(probe);
      probe.write(x224Req);
      const cc = await readX224(chan, this.opts.x224TimeoutMs);
      if (!cc.confirm) return [];

      const tlsSock = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const wrapped = new tls.TLSSocket(probe, { isServer: false, rejectUnauthorized: false });
        const timer = setTimeout(() => {
          wrapped.destroy();
          reject(new Error('TLS-проба: таймаут'));
        }, this.opts.probeTimeoutMs);
        wrapped.once('secureConnect', () => {
          clearTimeout(timer);
          resolve(wrapped);
        });
        wrapped.once('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });

      const certs: Buffer[] = [];
      let cur: import('node:tls').PeerCertificate | null =
        tlsSock.getPeerCertificate(true) ?? null;
      const seen = new Set<string>();
      while (cur && cur.raw && !seen.has(cur.fingerprint)) {
        seen.add(cur.fingerprint);
        certs.push(Buffer.from(cur.raw));
        cur =
          (cur as unknown as { issuerCertificate?: import('node:tls').PeerCertificate })
            .issuerCertificate ?? null;
        if (cur && seen.has(cur.fingerprint)) break;
      }
      tlsSock.destroy();
      return certs;
    } catch {
      return [];
    } finally {
      if (!probe.destroyed) probe.destroy();
      this.probe = null;
    }
  }

  private async handleConnection(ws: WebSocket): Promise<void> {
    if (this.pending || this.relay) {
      ws.close(4000, 'gateway busy');
      return;
    }
    this.pending = { ws };
    this.report({ phase: 'connecting' });

    // 1. Ждём Request PDU одним бинарным сообщением.
    let reqBuf: Buffer;
    try {
      reqBuf = await new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('RDCleanPath: клиент не прислал Request')), 5000);
        ws.once('message', (data) => {
          clearTimeout(timer);
          resolve(toBuf(data));
        });
        ws.once('close', () => {
          clearTimeout(timer);
          reject(new Error('RDCleanPath: клиент отключился до Request'));
        });
      });
    } catch (e) {
      this.fail((e as Error).message);
      return;
    }

    let fields: RdcleanPathFields;
    try {
      fields = decodePdu(reqBuf);
    } catch (e) {
      this.sendWs(ws, encodeError({ errorCode: GENERAL_ERROR_CODE }));
      this.fail(`RDCleanPath: неразборчивый Request — ${(e as Error).message}`);
      return;
    }
    if (!fields.x224 || fields.x224.length === 0) {
      this.sendWs(ws, encodeError({ errorCode: GENERAL_ERROR_CODE }));
      this.fail('RDCleanPath: в Request нет X.224 PDU');
      return;
    }
    const x224Req = fields.x224;

    // 2. Релейное соединение к серверу.
    let relay: net.Socket;
    try {
      relay = await this.tcpConnect();
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      const wsa = wsaCodeFor(err);
      this.sendWs(ws, encodeError(wsa ? { errorCode: GENERAL_ERROR_CODE, wsaErrorCode: wsa } : {}));
      this.fail(`TCP ${this.opts.host}:${this.opts.port}: ${err.message}`);
      return;
    }
    this.relay = relay;

    // 3. X.224 согласование.
    const chan = new ChannelBuffer(relay);
    relay.write(x224Req);
    let cc: { confirm: boolean; bytes: Buffer };
    try {
      cc = await readX224(chan, this.opts.x224TimeoutMs);
    } catch (e) {
      this.sendWs(ws, encodeError({ errorCode: GENERAL_ERROR_CODE }));
      relay.destroy();
      this.fail(`X.224: ${(e as Error).message}`);
      return;
    }
    if (!cc.confirm) {
      // Отрицательное согласование (например, «CredSSP required») — пробрасываем как есть.
      this.sendWs(ws, encodeError({ errorCode: NEGOTIATION_ERROR_CODE, negotiationX224: cc.bytes }));
      relay.destroy();
      this.fail('X.224: сервер отклонил согласование');
      return;
    }

    // 4. Цепочка сертификатов (best-effort).
    const certs = await this.probeCertificates(x224Req);

    // 5. Response и сырой пайп.
    const addr = `${this.opts.host}:${this.opts.port}`;
    this.sendWs(ws, encodeResponse(cc.bytes, certs, addr));
    this.pending = null;

    ws.on('message', (data) => {
      relay.write(toBuf(data));
    });
    // Накопленное с момента согласования и весь дальнейший поток — клиенту.
    chan.startTunneling((chunk: Buffer) => this.sendWs(ws, chunk));
    const teardown = (why: string): void => {
      if (this.closed) return;
      this.report({ phase: 'closed', message: why });
      try { ws.close(); } catch { /* ignore */ }
      if (!relay.destroyed) relay.destroy();
    };
    ws.on('close', () => teardown('клиент отключился'));
    ws.on('error', () => teardown('ошибка websocket'));
    relay.on('close', () => teardown('сервер закрыл соединение'));
    relay.on('error', (e) => teardown(`ошибка TCP: ${e.message}`));

    this.report({ phase: 'connected', message: addr });
  }

  private fail(message: string): void {
    this.report({ phase: 'error', message });
    this.destroySockets();
  }

  private destroySockets(): void {
    if (this.relay && !this.relay.destroyed) this.relay.destroy();
    if (this.probe && !this.probe.destroyed) this.probe.destroy();
  }

  /** Полностью останавливает шлюз. */
  async stop(): Promise<void> {
    this.closed = true;
    this.destroySockets();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      // Живые клиенты держат close(): рвём принудительно.
      for (const client of this.wss.clients) {
        try { client.terminate(); } catch { /* ignore */ }
      }
      this.wss.close(() => resolve());
    });
    this.wss = null;
    this.server = null;
  }
}
