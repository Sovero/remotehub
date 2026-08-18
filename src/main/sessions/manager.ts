import { readFileSync } from 'fs';
import { nanoid } from 'nanoid';
import type { SessionState } from '../../shared/ipc-contract';
import type { CredentialSet, Host } from '../../shared/types';
import type { Sealer } from '../store/crypto-format';
import { buildSshConfig, buildTelnetConfig, resolveAuth } from './config';
import { SshSession } from './ssh-session';
import { TelnetSession } from './telnet-session';
import type { SessionTransport } from './types';

export interface OpenSessionOptions {
  id?: string;
  host: Host;
  credential: CredentialSet | null;
  dialogPassword?: string;
  cols?: number;
  rows?: number;
}

interface Managed {
  id: string;
  host: Host;
  credential: CredentialSet | null;
  transport: SessionTransport | null;
  dialogPasswordUsed: boolean;
  disposed: boolean;
}

export class SessionManager {
  private readonly sessions = new Map<string, Managed>();

  constructor(
    private readonly sealer: Sealer,
    private readonly send: (channel: 'session:data' | 'session:state', payload: unknown) => void
  ) {}

  open(opts: OpenSessionOptions): string {
    const id = opts.id ?? nanoid(10);
    const managed: Managed = {
      id,
      host: opts.host,
      credential: opts.credential,
      transport: null,
      dialogPasswordUsed: Boolean(opts.dialogPassword),
      disposed: false
    };
    this.sessions.set(id, managed);
    this.startTransport(managed, opts.dialogPassword, opts.cols ?? 80, opts.rows ?? 24);
    return id;
  }

  input(id: string, data: Buffer): void {
    this.sessions.get(id)?.transport?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.transport?.resize(cols, rows);
  }

  close(id: string): void {
    const managed = this.sessions.get(id);
    if (!managed) return;
    managed.disposed = true;
    managed.transport?.close();
    this.sessions.delete(id);
  }

  closeAll(): void {
    for (const m of [...this.sessions.values()]) {
      m.disposed = true;
      m.transport?.close();
    }
    this.sessions.clear();
  }

  /** Пароль из диалога: переподключаемся с ним. */
  retryWithPassword(id: string, password: string): void {
    const managed = this.sessions.get(id);
    if (!managed || managed.disposed) return;
    managed.transport?.dispose();
    managed.transport = null;
    managed.dialogPasswordUsed = true;
    this.startTransport(managed, password, 80, 24);
  }

  private startTransport(managed: Managed, dialogPassword: string | undefined, cols: number, rows: number): void {
    if (managed.disposed) return;

    const emit = (state: SessionState): void => {
      this.send('session:state', { sessionId: managed.id, state });
    };
    const onData = (data: Buffer): void => {
      this.send('session:data', { sessionId: managed.id, data: data.toString('base64') });
    };

    if (managed.host.protocol === 'telnet') {
      const transport = new TelnetSession(buildTelnetConfig(managed.host), { onData, onState: emit });
      managed.transport = transport;
      transport.open(cols, rows);
      return;
    }

    // SSH
    const auth = resolveAuth(managed.credential, dialogPassword, this.sealer, (p) => readFileSync(p, 'utf8'));
    const config = buildSshConfig(managed.host, auth);
    const transport = new SshSession(config, { onData, onState: emit }, (message) => {
      // Нет пароля для аутентификации — просим пользователя.
      if (!managed.disposed && !managed.dialogPasswordUsed) {
        emit({ phase: 'auth-required', detail: 'Введите пароль для подключения' });
      } else {
        emit({ phase: 'error', message });
      }
    });
    managed.transport = transport;
    transport.open(cols, rows);
  }
}
