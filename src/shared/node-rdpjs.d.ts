declare module 'node-rdpjs' {
  import type { EventEmitter } from 'events';

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
    on(event: 'bitmap', listener: (bitmaps: Record<string, { obj: Record<string, { value: unknown }> }>) => void): this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createClient(config: Record<string, any>): RdpClient;
  export function createServer(config: Record<string, unknown>): unknown;
}