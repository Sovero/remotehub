/**
 * E2E: реальный RDP-хост через IronGateway (IronRDP-мост).
 *
 * Проверяет живой сетевой путь без ввода пароля: TCP-подключение к порту 3389,
 * X.224 Connection Request с RDP-переговорами (SSL + CredSSP) и ответ сервера,
 * проброшенный обратно через локальный WebSocket-туннель.
 *
 * Опт-ин: тест пропускается, пока не задан RH_E2E_RDP_HOST — обычный `npm test`
 * не должен зависеть от конкретного сервера или сети.
 *
 *   PowerShell:
 *     $env:RH_E2E_RDP_HOST = "10.10.51.2"
 *     $env:RH_E2E_RDP_PORT = "3389"    # optional
 *     npm run test:e2e:rdp
 *
 *   Unix shell:
 *     RH_E2E_RDP_HOST=10.10.51.2 npm run test:e2e:rdp
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  IronGateway,
  NEGOTIATION_ERROR_CODE,
  RDCLEANPATH_VERSION,
  decodePdu,
  encodeRequest,
  type RdcleanPathFields
} from '../src/main/rdp/iron-gateway';

const host = process.env.RH_E2E_RDP_HOST?.trim() ?? '';
const port = Number(process.env.RH_E2E_RDP_PORT ?? 3389);

/**
 * X.224 Connection Request с RDP-переговорами: предлагаем SSL (0x01) и
 * CredSSP/Hybrid (0x02). Так запрос шлёт современный клиент к хосту с NLA.
 */
const X224_CR_NEG = Buffer.from([
  0x03, 0x00, 0x00, 0x13, // TPKT: длина 19
  0x0e, // length-indicator = 14
  0xe0, // Connection Request
  0x00, 0x00, 0x00, 0x00, 0x00, // dest ref + src ref + class option
  0x01, 0x00, 0x08, 0x00, 0x03, 0x00, 0x00, 0x00 // TYPE_RDP_NEG_REQ, протоколы 0x03
]);

function wsConnect(wsPort: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function wsToBuf(data: unknown): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  const u = data as Uint8Array;
  if (u && u.buffer) return Buffer.from(u.buffer as ArrayBuffer, u.byteOffset, u.byteLength);
  return Buffer.from(data as ArrayBuffer);
}

function nextWsMessage(ws: WebSocket, timeoutMs = 20000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws: не дождались ответа шлюза')), timeoutMs);
    const onMsg = (data: unknown): void => {
      clearTimeout(timer);
      cleanup();
      resolve(wsToBuf(data));
    };
    const onClose = (): void => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('ws: соединение закрыто до ответа'));
    };
    const cleanup = (): void => {
      ws.off('message', onMsg);
      ws.off('close', onClose);
    };
    ws.on('message', onMsg);
    ws.on('close', onClose);
  });
}

function summarize(f: RdcleanPathFields): string {
  if (f.errorCode === undefined) {
    const pdu = f.x224 ?? Buffer.alloc(0);
    return `confirm=${pdu.length > 5 && pdu[5] === 0xd0} x224=${pdu.toString('hex').slice(0, 48)}`;
  }
  return `errorCode=${f.errorCode} wsa=${f.wsaErrorCode ?? '—'} x224=${(f.x224 ?? Buffer.alloc(0))
    .toString('hex')
    .slice(0, 48) || '—'}`;
}

describe.skipIf(!host)('IronRDP E2E — реальный RDP-хост', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()!();
    }
  }, 15000);

  it(`проходит X.224-переговоры с ${host}:${port}`, async () => {
    const states: string[] = [];
    const gw = new IronGateway({
      sessionId: 'e2e',
      host,
      port,
      connectTimeoutMs: 8000,
      x224TimeoutMs: 8000,
      probeTimeoutMs: 6000,
      onState: (_id, s) => states.push(s.phase)
    });
    await gw.start();
    cleanups.push(() => gw.stop());

    const ws = await wsConnect(gw.buildWsUrl());
    ws.send(encodeRequest(`${host}:${port}`, gw.authToken, X224_CR_NEG));

    const pdu = decodePdu(await nextWsMessage(ws));
    ws.close();

    // Версия RDCleanPath обязательна в любом ответе — мост точно ответил.
    expect(pdu.version, `нет версии RDCleanPath: ${summarize(pdu)}`).toBe(RDCLEANPATH_VERSION);

    // Общая ошибка (TCP недоступен / таймаут / отказ) — это провал живой проверки.
    if (pdu.errorCode !== undefined && pdu.errorCode !== NEGOTIATION_ERROR_CODE) {
      throw new Error(
        `не удалось достучаться до ${host}:${port}: ${summarize(pdu)}`
      );
    }

    // Успех: сервер подтвердил соединение (Connection Confirm, 0xD0).
    const confirmed = pdu.errorCode === undefined && pdu.x224 !== undefined && pdu.x224[5] === 0xd0;

    // Отрицательное согласование — тоже валидный ответ живого сервера,
    // доказывающий, что TCP + X.224 путь работает; проброшен с x224 сервера.
    const negotiatedError = pdu.errorCode === NEGOTIATION_ERROR_CODE && pdu.x224 !== undefined;

    expect(confirmed || negotiatedError, `неожиданный ответ: ${summarize(pdu)}`).toBe(true);

    if (confirmed) {
      expect(states).toContain('connected');
    } else {
      expect(states).toContain('error');
    }
  });

  it(`возвращает цепочку сертификатов ${host}:${port} (нужна WASM-клиенту)`, async () => {
    const gw = new IronGateway({
      sessionId: 'e2e-cert',
      host,
      port,
      connectTimeoutMs: 8000,
      x224TimeoutMs: 8000,
      probeTimeoutMs: 6000
    });
    await gw.start();
    cleanups.push(() => gw.stop());

    const ws = await wsConnect(gw.buildWsUrl());
    ws.send(encodeRequest(`${host}:${port}`, gw.authToken, X224_CR_NEG));
    const pdu = decodePdu(await nextWsMessage(ws));
    ws.close();

    // Сердце фикса probeCertificates: WASM-клиент IronRDP обрывает соединение
    // с «server cert chain missing», если цепочка пустая. Живой хост обязан
    // отдавать непустую цепочку (самоподписанный сертификат Windows RDP).
    expect(pdu.errorCode, `ошибка моста: ${summarize(pdu)}`).toBeUndefined();
    expect(pdu.x224?.[5]).toBe(0xd0);
    expect(pdu.certChain?.length ?? 0, `пустая цепочка: ${summarize(pdu)}`).toBeGreaterThan(0);
  }, 30000);
});
