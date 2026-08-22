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

  it('буферизует ранние байты сервера до подключения WebSocket-клиента', async () => {
    // RFB-сервер шлёт свой баннер сразу после TCP-connect — раньше, чем
    // noVNC успевает открыть WebSocket. Эти байты не должны теряться,
    // иначе рукопожатие зависает навсегда.
    const banner = Buffer.from('RFB 003.008\n');
    tcpServer = createServer((socket) => {
      socket.write(banner); // шлём баннер немедленно
      socket.on('data', () => undefined);
    });
    tcpServer.listen(0, '127.0.0.1');
    await once(tcpServer, 'listening');
    const tcpPort = (tcpServer.address() as { port: number }).port;

    bridge = await startBridge('127.0.0.1', tcpPort);

    // Подключаемся ПОСЛЕ того, как баннер уже ушёл в мост. Слушатель
    // вешаем до 'open', чтобы не пропустить баннер, отправленный мостом
    // сразу после установки WebSocket-соединения.
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    const bannerReceived = new Promise<Buffer>((resolve) => {
      ws.on('message', (data) => resolve(Buffer.from(data as Buffer)));
    });
    await once(ws, 'open');

    const got = await bannerReceived;
    expect(got.toString()).toBe('RFB 003.008\n');
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

describe('vnc bridge: распознавание проблем рукопожатия', () => {
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

  const listen = async (handler: (socket: import('net').Socket) => void): Promise<number> => {
    tcpServer = createServer(handler);
    tcpServer.listen(0, '127.0.0.1');
    await once(tcpServer, 'listening');
    return (tcpServer.address() as { port: number }).port;
  };

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it('сервер молчит — сообщение «не отвечает на рукопожатие»', async () => {
    const port = await listen(() => {
      // не пишем ничего
    });
    const errors: string[] = [];
    bridge = await startBridge('127.0.0.1', port, (m) => errors.push(m), { versionTimeoutMs: 100 });
    await sleep(250);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('не отвечает на рукопожатие');
  });

  it('не-RFB ответ — сообщение «не VNC-сервер»', async () => {
    const port = await listen((socket) => {
      socket.write(Buffer.from('HTTP/1.1 200 OK\r\n\r\n'));
      socket.on('data', () => undefined);
    });
    const errors: string[] = [];
    bridge = await startBridge('127.0.0.1', port, (m) => errors.push(m), { versionTimeoutMs: 500 });
    await sleep(150);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('не VNC-сервер');
  });

  it('неподдерживаемые типы security (3.8, список) — сообщение о шифровании', async () => {
    const port = await listen((socket) => {
      socket.write(Buffer.from('RFB 003.008\n'));
      socket.on('data', () => {
        socket.write(Buffer.from([1, 3])); // 1 тип: 3 — неподдерживаемый
      });
    });
    const errors: string[] = [];
    bridge = await startBridge('127.0.0.1', port, (m) => errors.push(m), { versionTimeoutMs: 500 });
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    await once(ws, 'open');
    ws.send(Buffer.from('RFB 003.008\n'));
    await sleep(150);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('тип шифрования');
    ws.close();
  });

  it('неподдерживаемый тип security (3.3, одиночный байт) — сообщение о шифровании', async () => {
    const port = await listen((socket) => {
      socket.write(Buffer.from('RFB 003.003\n'));
      socket.on('data', () => {
        socket.write(Buffer.from([3])); // 3 — неподдерживаемый
      });
    });
    const errors: string[] = [];
    bridge = await startBridge('127.0.0.1', port, (m) => errors.push(m), { versionTimeoutMs: 500 });
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    await once(ws, 'open');
    ws.send(Buffer.from('RFB 003.003\n'));
    await sleep(150);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('тип шифрования');
    ws.close();
  });

  it('поддерживаемые типы (None) — ошибок нет', async () => {
    const port = await listen((socket) => {
      socket.write(Buffer.from('RFB 003.008\n'));
      socket.on('data', () => {
        socket.write(Buffer.from([1, 1])); // 1 тип: 1 (None) — поддерживается
      });
    });
    const errors: string[] = [];
    bridge = await startBridge('127.0.0.1', port, (m) => errors.push(m), { versionTimeoutMs: 500 });
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    await once(ws, 'open');
    ws.send(Buffer.from('RFB 003.008\n'));
    await sleep(150);
    expect(errors.length).toBe(0);
    ws.close();
  });
});
