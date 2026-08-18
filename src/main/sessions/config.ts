import type { ConnectConfig } from 'ssh2';
import type { CredentialSet, Host } from '../../shared/types';
import { unsealSecret, type Sealer } from '../store/crypto-format';

export const WINDOWS_SSH_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';

export interface AuthResolution {
  password?: string;
  privateKey?: string;
  passphrase?: string;
  agent?: string;
}

/**
 * Собирает аутентификацию из набора учётных данных и/или пароля из диалога.
 * Пароль из диалога используется только если в наборе нет сохранённого
 * пароля или набора нет вовсе.
 */
export function resolveAuth(
  credential: CredentialSet | null,
  dialogPassword: string | undefined,
  sealer: Sealer,
  readKey: (path: string) => string
): AuthResolution {
  if (credential) {
    if (credential.passwordMode === 'stored' && credential.passwordCipher) {
      return { password: unsealSecret(credential.passwordCipher, sealer) };
    }
    if (credential.keyFile) {
      const auth: AuthResolution = { privateKey: readKey(credential.keyFile) };
      if (credential.keyPassphraseCipher) {
        auth.passphrase = unsealSecret(credential.keyPassphraseCipher, sealer);
      }
      return auth;
    }
    if (credential.useAgent) {
      return { agent: agentPath() };
    }
    if (credential.passwordMode === 'ask' && dialogPassword) {
      return { password: dialogPassword };
    }
    return {};
  }
  return dialogPassword ? { password: dialogPassword } : {};
}

function agentPath(): string {
  if (process.platform === 'win32') return WINDOWS_SSH_AGENT_PIPE;
  return process.env.SSH_AUTH_SOCK ?? WINDOWS_SSH_AGENT_PIPE;
}

export function effectiveUsername(host: Host, credential: CredentialSet | null): string {
  return credential?.username || host.username || '';
}

/** Опции ssh2 из хоста и разрешённой аутентификации. */
export function buildSshConfig(host: Host, auth: AuthResolution): ConnectConfig {
  return {
    host: host.host,
    port: host.port ?? 22,
    username: host.username || undefined,
    readyTimeout: (host.ssh?.timeout ?? 10) * 1000,
    keepaliveInterval: host.ssh?.keepalive ? host.ssh.keepalive * 1000 : 0,
    keepaliveCountMax: 3,
    password: auth.password,
    privateKey: auth.privateKey,
    passphrase: auth.passphrase,
    agent: auth.agent,
    // allowAgentAuthForOnly: true,
    algorithms: undefined
  };
}

/** Опции telnet-client из хоста. */
export function buildTelnetConfig(host: Host): {
  host: string;
  port: number;
  timeout: number;
  negotiationMandatory: boolean;
} {
  return {
    host: host.host,
    port: host.port ?? 23,
    timeout: (host.ssh?.timeout ?? 10) * 1000,
    negotiationMandatory: false
  };
}
