/**
 * RDP-клиент на чистом JavaScript (node-rdpjs-2) — запасной движок
 * «Legacy canvas» (второй в настройках, наряду с IronRDP/WASM).
 *
 * Реализует протокол RDP напрямую: TCP → X.224 → MCS → RDP.
 * Битмапы отдаются в renderer для рендеринга на Canvas.
 * Никакого mstsc.exe, SetParent, HWND — только DOM.
 *
 * Замечания по производительности (источник: lib/protocol/rdp.js и
 * lib/core/rle.js пакета node-rdpjs-2):
 *  - событие 'bitmap' приходит ПЛОСКИМ объектом { destTop, destLeft, ..., data } —
 *    ранее код ждал вложенный формат (obj.width и т.п.), которого движок не шлёт:
 *    обработчик падал на первом же кадре и экран не обновлялся;
 *  - без опции decompress серверные RLE-битмапы приходят сжатыми и не могут
 *    быть отрисованы вовсе; WASM-распаковщик rle.js в main-процессе разворачивает
 *    их в 32-битный буфер;
 *  - logLevel 'INFO' печатает построчный спам в stderr на каждый PDU, что на
 *    живом сеансе ощутимо тормозит main-процесс — понижен до 'ERROR'.
 */
import type { RdpClient } from 'node-rdpjs-2';

/** Плоский битмап из события 'bitmap' node-rdpjs-2 (формат emit в protocol/rdp.js). */
export interface RdpjsBitmap {
  destTop: number;
  destLeft: number;
  destBottom: number;
  destRight: number;
  width: number;
  height: number;
  bitsPerPixel: number;
  isCompress: boolean;
  /**
   * Пиксельные данные: BGRA 32-бит (распакованные RLE) либо сжатый поток
   * (если isCompress — такое не должно попадать в renderer).
   */
  data: Uint8Array;
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

/**
 * Конфиг createClient node-rdpjs-2. Вынесен отдельно для тестов:
 * здесь живут все флаги, влияющие на скорость отрисовки.
 */
export function buildRdpjsConfig(opts: RdpjsConnectOptions): Record<string, unknown> {
  const w = opts.width ?? 1366;
  const h = opts.height ?? 768;
  return {
    domain: opts.domain ?? '',
    userName: opts.username,
    password: opts.password,
    enablePerf: true,
    autoLogin: true,
    // Распаковка RLE-битмапов (WASM rle.js): без неё сжатые кадры приходят
    // в renderer необработанными и не могут быть отрисованы.
    decompress: true,
    screen: { width: w, height: h },
    locale: 'ru',
    // 'INFO' по умолчанию печатает в stderr на каждый PDU — на живом сеансе
    // это тысячи строк в секунду и ощутимое торможение main-процесса.
    logLevel: 'ERROR'
  };
}

/**
 * Нормализует плоское событие 'bitmap' node-rdpjs-2. Возвращает null для
 * кадров без валидных размеров/данных — такие отбрасываются, а не роняют
 * рендерер (раньше падение на первом кадре выглядело как «зависшая» сессия).
 */
export function normalizeRdpjsBitmapEvent(event: unknown): RdpjsBitmap | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  const width = typeof e.width === 'number' ? e.width : 0;
  const height = typeof e.height === 'number' ? e.height : 0;
  const data = e.data;
  if (width <= 0 || height <= 0) return null;
  if (!(data instanceof Uint8Array) || data.length === 0) return null;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    destTop: num(e.destTop),
    destLeft: num(e.destLeft),
    destBottom: num(e.destBottom),
    destRight: num(e.destRight),
    width,
    height,
    bitsPerPixel: typeof e.bitsPerPixel === 'number' ? e.bitsPerPixel : 32,
    isCompress: e.isCompress === true,
    data
  };
}

interface RdpjsSession {
  client: RdpClient;
  host: string;
  port: number;
  width: number;
  height: number;
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

    const client = rdp.createClient(buildRdpjsConfig(opts));

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

      // node-rdpjs-2 шлёт ПЛОСКИЙ объект битмапа (см. lib/protocol/rdp.js):
      // { destTop, destLeft, destBottom, destRight, width, height,
      //   bitsPerPixel, isCompress, data } — по одному emit на каждый прямоугольник.
      client.on('bitmap', (event: unknown) => {
        const bitmap = normalizeRdpjsBitmapEvent(event);
        if (!bitmap) return;
        if (bitmap.isCompress) {
          // Распаковка включена (buildRdpjsConfig), такое не ожидается:
          // не отрисовываем, чтобы renderer не получил бинарный мусор.
          return;
        }
        this.callbacks.onBitmap(sessionId, bitmap);
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