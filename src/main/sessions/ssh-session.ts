import { Client, type ConnectConfig, type ClientChannel } from 'ssh2';
import type { SessionState } from '../../shared/ipc-contract';
import type { SessionCallbacks, SessionTransport } from './types';

const TERM = 'xterm-256color';

function isAuthFailure(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('authentication') ||
    m.includes('permission denied') ||
    m.includes('all configured authentication methods failed') ||
    m.includes('no supported authentication methods')
  );
}

export class SshSession implements SessionTransport {
  private client: Client | null = null;
  private stream: ClientChannel | null = null;
  private disposed = false;
  private keyboardFinish: ((answers: string[]) => void) | null = null;

  constructor(
    private readonly config: ConnectConfig,
    private readonly cb: SessionCallbacks,
    /** Вызывается при ошибке аутентификации; message — текст ошибки ssh2. */
    private readonly onAuthRequired: (message: string) => void
  ) {}

  open(cols: number, rows: number): void {
    const client = new Client();
    this.client = client;
    this.cb.onState({ phase: 'connecting', detail: this.config.host });

    client.on('ready', () => {
      client.shell({ term: TERM, cols, rows }, (err, stream) => {
        if (err) {
          this.cb.onState({ phase: 'error', message: err.message });
          return;
        }
        this.stream = stream;
        stream.on('data', (chunk: Buffer) => {
          if (!this.disposed) this.cb.onData(chunk);
        });
        stream.on('close', () => {
          this.cb.onState({ phase: 'closed', reason: 'Соединение закрыто сервером' });
        });
        this.cb.onState({ phase: 'connected' });
      });
    });

    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      if (this.config.password) {
        finish([this.config.password]);
        return;
      }
      this.keyboardFinish = finish;
      this.cb.onState({ phase: 'auth-required', detail: prompts[0]?.prompt ?? 'Введите пароль' });
    });

    client.on('error', (err) => {
      if (isAuthFailure(err.message) && !this.disposed) {
        this.onAuthRequired(err.message);
        return;
      }
      this.cb.onState({ phase: 'error', message: err.message });
    });

    client.on('close', () => {
      if (!this.disposed && this.stream) {
        this.cb.onState({ phase: 'closed', reason: 'Соединение закрыто' });
      }
    });

    client.connect(this.config);
  }

  write(data: Buffer): void {
    this.stream?.write(data);
  }

  resize(cols: number, rows: number): void {
    try {
      this.stream?.setWindow(rows, cols, 0, 0);
    } catch {
      // окно могло закрыться — игнорируем
    }
  }

  close(): void {
    this.disposed = true;
    try {
      this.client?.end();
    } catch {
      // уже закрыт
    }
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.client?.destroy();
    } catch {
      // уже закрыт
    }
  }
}
