import type { SessionState } from '../../shared/ipc-contract';

export interface SessionCallbacks {
  onData: (data: Buffer) => void;
  onState: (state: SessionState) => void;
}

export interface SessionTransport {
  /** Подключиться и открыть терминал заданного размера. */
  open(cols: number, rows: number): void;
  write(data: Buffer): void;
  resize(cols: number, rows: number): void;
  close(): void;
  /** Закрыть транспорт необратимо (перед переподключением). */
  dispose(): void;
}
