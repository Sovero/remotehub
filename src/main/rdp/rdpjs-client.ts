/**
 * RDP-клиент на чистом JavaScript (node-rdpjs).
 *
 * Реализует протокол RDP напрямую: TCP → X.224 → MCS → RDP.
 * Битмапы отдаются в renderer для рендеринга на Canvas.
 * Никакого mstsc.exe, SetParent, HWND — только DOM.
 */
import type { RdpClient } from 'node-rdpjs-2';

interface RdpjsSession {
  client: RdpClient;
  host: string;
  port: number;
  width: number;
  height: number;
}

export interface RdpjsBitmap {
  destTop: number;
  destLeft: number;
  destBottom: number;
  destRight: number;
  width: number;
  height: number;
  bitsPerPixel: number;
  isCompress: boolean;
  /** Raw bitmap data (BGRA 32-bit or decompressed). */
  data: Buffer;
}

export interface RdpjsConnectOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  domain?: string;
  width?: number;
  height?: number;
}

export class RdpjsClientManager {
  private readonly sessions = new Map<string, RdpjsSession>();
  private readonly callbacks: {
    onBitmap: (sessionId: string, bitmap: RdpjsBitmap) => void;
    onState: (sessionId: string, state: 'connecting' | 'connected' | 'disconnected', error?: string) => void;
  };

  constructor(callbacks: {
    onBitmap: (sessionId: string, bitmap: RdpjsBitmap) => void;
    onState: (sessionId: string, state: 'connecting' | 'connected' | 'disconnected', error?: string) => void;
  }) {
    this.callbacks = callbacks;
  }

  async connect(sessionId: string, opts: RdpjsConnectOptions): Promise<{ ok: boolean; error?: string }> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rdp = require('node-rdpjs-2') as { createClient: (cfg: Record<string, unknown>) => RdpClient };

    const w = opts.width ?? 1366;
    const h = opts.height ?? 768;

    const client = rdp.createClient({
      domain: opts.domain ?? '',
      userName: opts.username,
      password: opts.password,
      enablePerf: true,
      autoLogin: true,
      screen: { width: w, height: h },
      locale: 'ru',
      logLevel: 'INFO'
    });

    return new Promise((resolve) => {
      let settled = false;

      const settle = (ok: boolean, error?: string): void => {
        if (settled) return;
        settled = true;
        if (ok) {
          this.sessions.set(sessionId, { client, host: opts.host, port: opts.port ?? 3389, width: w, height: h });
        } else {
          try { client.close(); } catch { /* ignore */ }
        }
        this.callbacks.onState(sessionId, ok ? 'connected' : 'disconnected', error);
        resolve({ ok, error });
      };

      client.on('connect', () => {
        this.callbacks.onState(sessionId, 'connecting');
      });

      client.on('session', () => {
        settle(true);
      });

      client.on('bitmap', (bitmaps: Record<string, { obj: Record<string, { value: unknown }> }>) => {
        for (const _key in bitmaps) {
          const obj = bitmaps[_key].obj;
          const data: Buffer = obj.bitmapDataStream.value as Buffer;
          const flags = obj.flags.value as number;
          const isCompress = !!(flags & 0x0400); // BITMAP_COMPRESSION

          const bitmap: RdpjsBitmap = {
            destTop: obj.destTop.value as number,
            destLeft: obj.destLeft.value as number,
            destBottom: obj.destBottom.value as number,
            destRight: obj.destRight.value as number,
            width: obj.width.value as number,
            height: obj.height.value as number,
            bitsPerPixel: obj.bitsPerPixel.value as number,
            isCompress,
            data
          };
          this.callbacks.onBitmap(sessionId, bitmap);
        }
      });

      client.on('close', () => {
        this.sessions.delete(sessionId);
        if (!settled) {
          settle(false, 'RDP-соединение закрыто сервером');
        } else {
          this.callbacks.onState(sessionId, 'disconnected');
        }
      });

      client.on('error', (err: Error & { code?: string }) => {
        this.sessions.delete(sessionId);
        settle(false, err.message || 'Ошибка RDP-соединения');
      });

      try {
        client.connect(opts.host, opts.port ?? 3389);
      } catch (err) {
        settle(false, (err as Error).message);
      }
    });
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.client.close();
    } catch {
      /* ignore */
    }
    this.sessions.delete(sessionId);
  }

  sendMouse(sessionId: string, x: number, y: number, button: number, isPressed: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.client.sendPointerEvent(x, y, button, isPressed);
    } catch {
      /* ignore */
    }
  }

  sendWheel(sessionId: string, x: number, y: number, step: number, isNegative: boolean, isHorizontal: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.client.sendWheelEvent(x, y, step, isNegative, isHorizontal);
    } catch {
      /* ignore */
    }
  }

  sendKeyScancode(sessionId: string, code: number, isPressed: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.client.sendKeyEventScancode(code, isPressed);
    } catch {
      /* ignore */
    }
  }

  sendKeyUnicode(sessionId: string, code: number, isPressed: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.client.sendKeyEventUnicode(code, isPressed);
    } catch {
      /* ignore */
    }
  }

  closeAll(): void {
    for (const [id, session] of this.sessions) {
      try {
        session.client.close();
      } catch {
        /* ignore */
      }
      this.sessions.delete(id);
    }
  }
}