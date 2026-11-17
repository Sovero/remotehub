import { readFileSync } from 'fs';
import { nanoid } from 'nanoid';
import type { HostVerifier } from 'ssh2';
import type { PasswordSaveScope, SessionState } from '../../shared/ipc-contract';
import type { CredentialSet, Host } from '../../shared/types';
import type { Sealer } from '../store/crypto-format';
import { buildSshConfig, buildTelnetConfig, resolveAuth } from './config';
import { HostKeyStore } from './host-keys';
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
  /** Пароль из диалога и куда его сохранить (после успешного подключения). */
  pendingSave: { password: string; scope: PasswordSaveScope } | null;
  disposed: boolean;
}

export class SessionManager {
  private readonly sessions = new Map<string, Managed>();

  /**
   * Сохранение пароля из диалога. Вызывается только после успешного
   * подключения, поэтому в хранилище не попадает пароль от неудачной попытки.
   * Реализацию даёт main (ipc.ts): там доступ к хранилищу и дереву профилей.
   */
  private passwordSaver: ((host: Host, password: string, scope: PasswordSaveScope) => void) | null = null;

  setPasswordSaver(saver: (host: Host, password: string, scope: PasswordSaveScope) => void): void {
    this.passwordSaver = saver;
  }

  constructor(
    private readonly sealer: Sealer,
    private readonly send: (channel: 'session:data' | 'session:state', payload: unknown) => void,
    private readonly hostKeyStore: HostKeyStore
  ) {}

  open(opts: OpenSessionOptions): string {
    const id = opts.id ?? nanoid(10);
    const managed: Managed = {
      id,
      host: opts.host,
      credential: opts.credential,
      transport: null,
      dialogPasswordUsed: Boolean(opts.dialogPassword),
      pendingSave: null,
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

  /** Пароль из диалога: переподключаемся с ним. scope — куда сохранить после успеха. */
  retryWithPassword(id: string, password: string, scope: PasswordSaveScope = 'none'): void {
    const managed = this.sessions.get(id);
    if (!managed || managed.disposed) return;
    managed.transport?.dispose();
    managed.transport = null;
    managed.dialogPasswordUsed = true;
    managed.pendingSave = scope === 'none' ? null : { password, scope };
    this.startTransport(managed, password, 80, 24);
  }

  /** Ответ пользователя на диалог подтверждения host key сервера (см. SshSession.handleHostKey). */
  resolveHostKey(id: string, accept: boolean): void {
    const managed = this.sessions.get(id);
    if (!managed || managed.disposed) return;
    if (managed.transport instanceof SshSession) {
      managed.transport.resolveHostKey(accept);
    }
  }

  private startTransport(managed: Managed, dialogPassword: string | undefined, cols: number, rows: number): void {
    if (managed.disposed) return;

    const emit = (state: SessionState): void => {
      this.send('session:state', { sessionId: managed.id, state });
      // Пароль с выбранным сохранением уходит в хранилище только после
      // успешного подключения — пароль от неудачной попытки не сохраняем.
      // Ошибки сохранения обрабатывает обработчик в main, сессию они не трогают.
      if (state.phase === 'connected' && managed.pendingSave) {
        const { password, scope } = managed.pendingSave;
        managed.pendingSave = null;
        this.passwordSaver?.(managed.host, password, scope);
      }
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
    // Пароль взят из хранилища (не из диалога): если сервер его не принял,
    // диалог предложит заменить пароль в наборе.
    const storedPasswordUsed =
      managed.credential?.passwordMode === 'stored' && Boolean(managed.credential.passwordCipher) && !dialogPassword;
    // hostVerifier подключается к HostKeyStore и ведёт в SshSession.handleHostKey — ssh2 держит
    // handshake до ответа через verify(); transport присваивается ниже, до открытия соединения.
    let transport: SshSession;
    const hostVerifier: HostVerifier = (keyBlob, verify) => {
      transport.handleHostKey(keyBlob, verify);
    };
    const config = buildSshConfig(managed.host, auth, hostVerifier);
    transport = new SshSession(
      config,
      { onData, onState: emit },
      (message) => {
        if (managed.disposed) return;
        // Уже спрашивали пароль в этой сессии — второй раз не предлагаем.
        if (managed.dialogPasswordUsed) {
          emit({ phase: 'error', message });
          return;
        }
        emit({
          phase: 'auth-required',
          detail: 'Введите пароль для подключения',
          savedCredential:
            storedPasswordUsed && managed.credential
              ? { id: managed.credential.id, name: managed.credential.name }
              : undefined
        });
      },
      this.hostKeyStore,
      managed.host.host,
      managed.host.port ?? 22
    );
    managed.transport = transport;
    transport.open(cols, rows);
  }
}
