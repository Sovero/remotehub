import { Telnet } from 'telnet-client';
import type { SessionCallbacks, SessionTransport } from './types';

export class TelnetSession implements SessionTransport {
  private connection: Telnet | null = null;
  private stream: NodeJS.ReadWriteStream | null = null;
  private disposed = false;

  constructor(
    private readonly config: { host: string; port: number; timeout: number; negotiationMandatory: boolean },
    private readonly cb: SessionCallbacks
  ) {}

  open(_cols: number, _rows: number): void {
    const connection = new Telnet();
    this.connection = connection;
    this.cb.onState({ phase: 'connecting', detail: this.config.host });

    connection.on('timeout', () => {
      if (!this.disposed) this.cb.onState({ phase: 'error', message: 'Таймаут соединения' });
    });

    connection
      .connect(this.config)
      .then(() => connection.shell())
      .then((stream) => {
        if (this.disposed) {
          void connection.end();
          return;
        }
        this.stream = stream;
        stream.on('data', (chunk: Buffer) => {
          if (!this.disposed) this.cb.onData(chunk);
        });
        stream.on('close', () => {
          if (!this.disposed) this.cb.onState({ phase: 'closed', reason: 'Соединение закрыто сервером' });
        });
        this.cb.onState({ phase: 'connected' });
      })
      .catch((err: Error) => {
        if (!this.disposed) {
          this.cb.onState({ phase: 'error', message: err.message || 'Не удалось подключиться' });
        }
      });
  }

  write(data: Buffer): void {
    this.stream?.write(data);
  }

  resize(): void {
    // Telnet NAWS не поддерживается клиентом — размер терминала не передаём.
  }

  close(): void {
    this.disposed = true;
    void this.connection?.end().catch(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    void this.connection?.end().catch(() => undefined);
  }
}
