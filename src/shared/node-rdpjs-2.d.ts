declare module 'node-rdpjs-2' {
  import type { EventEmitter } from 'events';

  /** Плоский битмап из события 'bitmap' (формат emit: lib/protocol/rdp.js). */
  export interface RdpjsBitmapEvent {
    destTop: number;
    destLeft: number;
    destBottom: number;
    destRight: number;
    width: number;
    height: number;
    bitsPerPixel: number;
    /** true, если данные сжаты RLE (при config.decompress: true — распакованы). */
    isCompress: boolean;
    /** BGRA 32-бит (распакованные) либо сжатый поток. */
    data: Uint8Array;
  }

  interface RdpClient extends EventEmitter {
    connect(host: string, port: number): void;
    close(): void;
    sendPointerEvent(x: number, y: number, button: number, isPressed: boolean): void;
    sendWheelEvent(x: number, y: number, step: number, isNegative: boolean, isHorizontal: boolean): void;
    sendKeyEventScancode(code: number, isPressed: boolean, extended?: boolean): void;
    sendKeyEventUnicode(code: number, isPressed: boolean): void;

    on(event: 'connect', listener: () => void): this;
    on(event: 'session', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (err: Error & { code?: string }) => void): this;
    on(event: 'bitmap', listener: (bitmap: RdpjsBitmapEvent) => void): this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createClient(config: Record<string, any>): RdpClient;
  export function createServer(config: Record<string, unknown>): unknown;
}
