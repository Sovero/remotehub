/**
 * Регрессия: IronGateway должен отдавать клиенту цепочку сертификатов сервера.
 *
 * WASM-клиент IronRDP жёстко требует `server_cert_chain` в ответе RDCleanPath
 * (иначе — «server cert chain missing from rdcleanpath response» и обрыв
 * соединения сразу после X.224). Мост берёт цепочку из TLS-рукопожатия на
 * отдельном пробном соединении.
 *
 * Баг, который ловит тест: `new tls.TLSSocket(sock)` поверх уже существующего
 * net-сокета НЕ начинает рукопожатие — сервер так и не получает ClientHello,
 * проба падает по таймауту и цепочка уходит пустой. Правильный способ —
 * `tls.connect({ socket })`. Тест поднимает фейковый RDP-сервер (X.224 Confirm
 * → TLS) и проверяет, что клиент получил непустую цепочку.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { WebSocket } from 'ws';
import { IronGateway, decodePdu, encodeRequest } from '../src/main/rdp/iron-gateway';

const X224_CR_NEG = Buffer.from([
  0x03, 0x00, 0x00, 0x13, 0x0e, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x08, 0x00, 0x03, 0x00, 0x00, 0x00
]);

describe('IronGateway — получение цепочки сертификатов', () => {
  let server: net.Server;
  let port = 0;
  let keyPem: string;
  let certPem: string;

  beforeAll(async () => {
    // Самоподписанный сертификат через openssl (как у реального RDP-хоста).
    const dir = crypto.randomBytes(8).toString('hex');
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout ${dir}.key -out ${dir}.crt -days 1 -nodes -subj "/CN=rdp.local" 2>NUL`,
      { shell: 'cmd.exe' }
    );
    keyPem = readFileSync(`${dir}.key`, 'utf8');
    certPem = readFileSync(`${dir}.crt`, 'utf8');
    rmSync(`${dir}.key`, { force: true });
    rmSync(`${dir}.crt`, { force: true });
    if (!keyPem || !certPem) throw new Error('openssl не сгенерировал сертификат');

    server = net.createServer((sock) => {
      sock.once('data', (chunk: Buffer) => {
        if (chunk.length < 4) return;
        const total = chunk.readUInt16BE(2);
        // X.224 Connection Confirm — как у живого RDP-сервера с NLA.
        const confirm = Buffer.concat([
          Buffer.from([0x03, 0x00]),
          Buffer.from([0, total]),
          Buffer.from([0x0e, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00]),
          chunk.subarray(11, total)
        ]);
        sock.write(confirm);
        // После X.224 сервер переходит в TLS.
        const tlsSock = new tls.TLSSocket(sock, { isServer: true, key: keyPem, cert: certPem });
        tlsSock.on('error', () => undefined);
        tlsSock.on('secureConnection', () => {
          tlsSock.write('TLS-OK');
        });
        tlsSock.on('data', () => undefined);
      });
      sock.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('возвращает клиенту непустую цепочку сертификатов', async () => {
    const gw = new IronGateway({
      sessionId: 'probe',
      host: '127.0.0.1',
      port,
      connectTimeoutMs: 4000,
      x224TimeoutMs: 4000,
      probeTimeoutMs: 4000
    });
    await gw.start();
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const w = new WebSocket(`ws://127.0.0.1:${gw.actualPort}`);
      w.once('open', () => resolve(w));
      w.once('error', reject);
    });
    ws.send(encodeRequest(`127.0.0.1:${port}`, 'probe', X224_CR_NEG));
    const msg = await new Promise<Buffer>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('нет ответа моста')), 10000);
      ws.once('message', (d) => {
        clearTimeout(t);
        resolve(Buffer.from(d as ArrayBuffer));
      });
    });
    const pdu = decodePdu(msg);
    ws.close();
    await gw.stop();

    expect(pdu.version).toBe(3390);
    expect(pdu.errorCode).toBeUndefined();
    expect(pdu.x224?.[5]).toBe(0xd0);
    // Пустая цепочка = WASM-клиент оборвёт соединение («server cert chain
    // missing») — это регрессия, которую тест не должен пропускать.
    expect(pdu.certChain?.length ?? 0).toBeGreaterThan(0);
  }, 15000);
});
