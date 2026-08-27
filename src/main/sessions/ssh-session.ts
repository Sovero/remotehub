import { Client, type ConnectConfig, type ClientChannel } from 'ssh2';
import type { SessionState } from '../../shared/ipc-contract';
import type { SessionCallbacks, SessionTransport } from './types';
import { HostKeyStore, parseHostKey } from './host-keys';
import { addLog } from '../log';

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
  /** ssh2 держит handshake до вызова этого callback — заполняется в handleHostKey, потребляется в resolveHostKey/dispose. */
  private hostKeyVerify: ((accept: boolean) => void) | null = null;
  private pendingHostKey: { algo: string; fingerprint: string } | null = null;
  /** true — мы сами уже перевели сессию в error по отказу host key; подавляет дублирующий error от ssh2. */
  private hostKeyRejected = false;

  constructor(
    private readonly config: ConnectConfig,
    private readonly cb: SessionCallbacks,
    /** Вызывается при ошибке аутентификации; message — текст ошибки ssh2. */
    private readonly onAuthRequired: (message: string) => void,
    private readonly hostKeyStore: HostKeyStore,
    private readonly host: string,
    private readonly port: number
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
      // Отказ от host key уже обработан в resolveHostKey — не затираем понятный русский текст.
      if (this.hostKeyRejected) return;
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

  /**
   * ssh2 hostVerifier: проверка host key сервера (TOFU). Вызывается синхронно
   * ssh2-протоколом при получении ключа во время handshake; verify — колбэк
   * ssh2, который нужно вызвать с решением (можно асинхронно).
   */
  handleHostKey(keyBlob: Buffer, verify: (accept: boolean) => void): void {
    if (this.disposed) {
      verify(false);
      return;
    }
    const { algo, fingerprint } = parseHostKey(keyBlob);
    const known = this.hostKeyStore.get(this.host, this.port);
    if (known && known.algo === algo && known.fingerprint === fingerprint) {
      // Уже видели этот host:port с тем же отпечатком — TOFU, без диалога.
      verify(true);
      return;
    }
    this.hostKeyVerify = verify;
    this.pendingHostKey = { algo, fingerprint };
    const detail = known
      ? `host-key:changed:${this.host}:${this.port}:${algo}:${fingerprint}:${known.fingerprint}`
      : `host-key:new:${this.host}:${this.port}:${algo}:${fingerprint}`;
    this.cb.onState({ phase: 'auth-required', detail });
  }

  /** Ответ пользователя на диалог подтверждения host key (см. handleHostKey). */
  resolveHostKey(accept: boolean): void {
    const verify = this.hostKeyVerify;
    if (!verify) return;
    const pending = this.pendingHostKey;
    this.hostKeyVerify = null;
    this.pendingHostKey = null;
    if (accept) {
      if (pending) this.hostKeyStore.put(this.host, this.port, pending.algo, pending.fingerprint);
      verify(true);
      return;
    }
    addLog('warn', 'ssh', `Отпечаток ключа сервера ${this.host}:${this.port} отклонён пользователем`);
    this.hostKeyRejected = true;
    try {
      verify(false);
    } catch {
      // ssh2 могло уже развалить соединение — игнорируем
    }
    this.cb.onState({ phase: 'error', message: 'Отпечаток ключа сервера отклонён — подключение отменено' });
    this.dispose();
  }

  close(): void {
    this.disposed = true;
    this.declineIfHostKeyPending();
    try {
      this.client?.end();
    } catch {
      // уже закрыт
    }
  }

  dispose(): void {
    this.disposed = true;
    this.declineIfHostKeyPending();
    try {
      this.client?.destroy();
    } catch {
      // уже закрыт
    }
  }

  /**
   * Вкладку/сессию закрыли, пока диалог подтверждения host key ещё открыт —
   * отвечаем ssh2 отказом сами, чтобы handshake не завис на неотвеченном
   * callback и close()/dispose() не бросали необработанное исключение.
   */
  private declineIfHostKeyPending(): void {
    const verify = this.hostKeyVerify;
    if (!verify) return;
    this.hostKeyVerify = null;
    this.pendingHostKey = null;
    this.hostKeyRejected = true;
    try {
      verify(false);
    } catch {
      // ssh2 могло уже развалить соединение — игнорируем
    }
  }
}
