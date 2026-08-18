import { createServer, type Server } from 'net';
import { once } from 'events';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { startBridge } from '../src/main/vnc/bridge';

describe('vnc bridge', () => {
  let tcpServer: Server | null = null;
  let bridge: Awaited<ReturnType<typeof startBridge>> | null = null;

  afterEach(async () => {
    bridge?.close();
    bridge = null;
    if (tcpServer) {
      tcpServer.close();
      await once(tcpServer, 'close').catch(() => undefined);
      tcpServer = null;
    }
  });

  it('пересылает байты из WebSocket в TCP и обратно', async () => {
    // Эхо-сервер: всё, что приходит, отправляется обратно.
    tcpServer = createServer((socket) => {
      socket.on('data', (d) => socket.write(d));
    });
    tcpServer.listen(0, '127.0.0.1');
    await once(tcpServer, 'listening');
    const tcpPort = (tcpServer.address() as { port: number }).port;

    bridge = await startBridge('127.0.0.1', tcpPort);

    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    await once(ws, 'open');

    const reply = new Promise<string>((resolve) => {
      ws.on('message', (data) => resolve(data.toString()));
    });
    ws.send(Buffer.from('vnc-hello'));

    const echoed = await reply;
    expect(echoed).toBe('vnc-hello');
    ws.close();
  });

  it('возвращает ошибку, если VNC-сервер недоступен', async () => {
    // Порт, на котором никто не слушает (выбрали и сразу закрыли).
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const deadPort = (probe.address() as { port: number }).port;
    probe.close();
    await once(probe, 'close');

    await expect(startBridge('127.0.0.1', deadPort)).rejects.toThrow(/VNC-сервер/);
  });
});
