import { createConnection, type Socket } from 'net';
import { WebSocket, WebSocketServer } from 'ws';

export interface BridgeHandle {
  port: number;
  close: () => void;
}

/** Типы security, которые умеет noVNC (см. _isSupportedSecurityType в rfb.js). */
const SUPPORTED_SECURITY_TYPES = new Set([1, 2, 6, 16, 19, 22, 30, 113]);

/**
 * Следит за RFB-рукопожатием (не вмешиваясь в пересылку байтов) и вызывает
 * onError с понятным сообщением, если сервер не отвечает на рукопожатие,
 * отвечает не-RFB-байтами или требует неподдерживаемый тип шифрования.
 * Сообщение — ровно одно; соединение не рвём: рендерер показывает оверлей
 * с ошибкой, а закрытие вкладки уберёт мост.
 */
class RfbHandshakeWatcher {
  private phase: 'version' | 'client-version' | 'security' | 'done' = 'version';
  private serverBuf = Buffer.alloc(0);
  private clientBuf = Buffer.alloc(0);
  private version = '';
  private reported = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onError: (message: string) => void,
    private readonly versionTimeoutMs: number
  ) {}

  start(): void {
    // Сервер обязан прислать баннер версии сразу после TCP-connect.
    this.timer = setTimeout(() => {
      if (this.reported || this.phase === 'done') return;
      const msg =
        this.serverBuf.length > 0
          ? 'Ответ сервера не похож на VNC (рукопожатие не завершилось). Проверьте, что на адресе:порту работает VNC-сервер.'
          : 'VNC-сервер не отвечает на рукопожатие. Проверьте адрес и порт (по умолчанию 5900) — на этом порту должен работать VNC-сервер.';
      this.report(msg);
    }, this.versionTimeoutMs);
    this.timer.unref?.();
  }

  /** Байты от VNC-сервера (идут к noVNC). */
  serverData(chunk: Buffer): void {
    if (this.reported) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.phase === 'version') {
      this.serverBuf = Buffer.concat([this.serverBuf, chunk]);
      if (this.serverBuf.length < 12) return;
      const banner = this.serverBuf.subarray(0, 12).toString('ascii');
      if (!/^RFB \d{3}\.\d{3}\n$/.test(banner)) {
        this.report(
          'На этом порту работает не VNC-сервер (ответ не похож на RFB). Проверьте адрес и порт подключения.'
        );
        return;
      }
      this.version = banner.slice(4, 11);
      this.phase = 'client-version';
      this.serverBuf = Buffer.alloc(0);
    } else if (this.phase === 'security') {
      this.serverBuf = Buffer.concat([this.serverBuf, chunk]);
      this.checkSecurity();
    }
  }

  /** Байты от клиента (noVNC → сервер). */
  clientData(chunk: Buffer): void {
    if (this.reported || this.phase !== 'client-version') return;
    this.clientBuf = Buffer.concat([this.clientBuf, chunk]);
    if (this.clientBuf.length < 12) return;
    this.phase = 'security';
    this.clientBuf = Buffer.alloc(0);
  }

  private checkSecurity(): void {
    // RFB 3.3/3.6: сервер шлёт один байт — тип security. 3.7+: [count, types…].
    const isOld = this.version === '003.003' || this.version === '003.006';
    if (isOld) {
      if (this.serverBuf.length < 1) return;
      const type = this.serverBuf[0];
      if (type !== 0 && !SUPPORTED_SECURITY_TYPES.has(type)) {
        this.report(
          `VNC-сервер требует тип шифрования, который приложение не поддерживает (тип ${type}). Включите на сервере авторизацию без TLS или используйте VNC-клиент с поддержкой TLS.`
        );
      }
      this.phase = 'done';
      return;
    }
    if (this.serverBuf.length < 1) return;
    const count = this.serverBuf[0];
    if (count === 0) {
      // Сервер откажется сам (securityfailure) — тут не наш случай.
      this.phase = 'done';
      return;
    }
    if (this.serverBuf.length < 1 + count) return;
    const types: number[] = [];
    let supported = false;
    for (let i = 0; i < count; i++) {
      const t = this.serverBuf[1 + i];
      types.push(t);
      if (SUPPORTED_SECURITY_TYPES.has(t)) supported = true;
    }
    if (!supported) {
      this.report(
        `VNC-сервер требует тип шифрования, который приложение не поддерживает (типы: ${types.join(', ')}). Включите на сервере авторизацию без TLS (None/VNC) или используйте VNC-клиент с поддержкой TLS.`
      );
    }
    this.phase = 'done';
  }

  private report(msg: string): void {
    if (this.reported) return;
    this.reported = true;
    this.onError(msg);
  }
}

/**
 * Прозрачный мост: TCP-сокет до VNC-сервера и WebSocket-сервер на
 * 127.0.0.1:<случайный порт>. RFB-протокол мост знает ровно настолько,
 * чтобы распознать проблемы рукопожатия и сообщить о них понятно;
 * сами байты пересылаются в обе стороны без изменений.
 *
 * Промис разрешается только после подключения TCP к VNC-серверу:
 * к этому моменту мост уже готов принимать WebSocket-клиента.
 */
export function startBridge(
  targetHost: string,
  targetPort: number,
  onError?: (message: string) => void,
  opts?: { versionTimeoutMs?: number }
): Promise<BridgeHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    let tcp: Socket | null = null;
    let wsClient: WebSocket | null = null;
    let settled = false;
    let closed = false;
    // RFB-сервер шлёт свой баннер версии сразу после TCP-connect — раньше,
    // чем noVNC успевает открыть WebSocket. Буферизуем ранние байты и
    // отдаём их клиенту при подключении, иначе рукопожатие зависает навсегда.
    let pending: Buffer[] = [];
    const watcher = new RfbHandshakeWatcher(onError ?? (() => undefined), opts?.versionTimeoutMs ?? 10000);

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
        watcher.start();
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
        const buf = Buffer.from(chunk);
        watcher.serverData(buf);
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(buf);
        } else {
          pending.push(buf);
        }
      });
    });

    wss.on('connection', (socket) => {
      if (wsClient) {
        socket.close(4000, 'Один клиент на мост');
        return;
      }
      wsClient = socket;
      if (pending.length > 0) {
        for (const chunk of pending) socket.send(chunk);
        pending = [];
      }
      socket.on('message', (data) => {
        const buf = Buffer.from(data as Buffer);
        watcher.clientData(buf);
        if (tcp && !tcp.destroyed) tcp.write(buf);
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
