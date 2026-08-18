import { createConnection, type Socket } from 'net';
import { WebSocket, WebSocketServer } from 'ws';

export interface BridgeHandle {
  port: number;
  close: () => void;
}

/**
 * Прозрачный мост: TCP-сокет до VNC-сервера и WebSocket-сервер на
 * 127.0.0.1:<случайный порт>. RFB-протокол мост не знает — байты
 * пересылаются в обе стороны; рукопожатие и авторизацию ведёт noVNC.
 *
 * Промис разрешается только после подключения TCP к VNC-серверу:
 * к этому моменту мост уже готов принимать WebSocket-клиента.
 */
export function startBridge(targetHost: string, targetPort: number): Promise<BridgeHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    let tcp: Socket | null = null;
    let wsClient: WebSocket | null = null;
    let settled = false;
    let closed = false;

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      try {
        wss.close();
      } catch {
        // уже закрыт
      }
      try {
        tcp?.destroy();
      } catch {
        // уже закрыт
      }
      try {
        wsClient?.close();
      } catch {
        // уже закрыт
      }
    };

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    wss.on('error', (err) => {
      settle(() => reject(new Error(`Ошибка моста: ${err.message}`)));
    });

    wss.on('listening', () => {
      const address = wss.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      if (!port) {
        settle(() => reject(new Error('Не удалось получить порт моста')));
        return;
      }

      tcp = createConnection({ host: targetHost, port: targetPort });
      tcp.on('connect', () => {
        settle(() => resolve({ port, close: cleanup }));
      });
      tcp.on('error', (err) => {
        settle(() => reject(new Error(`Не удалось подключиться к VNC-серверу ${targetHost}:${targetPort} — ${err.message}`)));
      });
      tcp.on('close', () => {
        if (wsClient) {
          try {
            wsClient.close();
          } catch {
            // уже закрыт
          }
        }
      });
      tcp.on('data', (chunk) => {
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(chunk);
        }
      });
    });

    wss.on('connection', (socket) => {
      if (wsClient) {
        socket.close(4000, 'Один клиент на мост');
        return;
      }
      wsClient = socket;
      socket.on('message', (data) => {
        if (tcp && !tcp.destroyed) tcp.write(data as Buffer);
      });
      socket.on('close', () => {
        tcp?.destroy();
      });
      socket.on('error', () => {
        tcp?.destroy();
      });
    });
  });
}
