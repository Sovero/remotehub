import { describe, expect, it } from 'vitest';
import {
  buildSshConfig,
  buildTelnetConfig,
  effectiveUsername,
  resolveAuth,
  WINDOWS_SSH_AGENT_PIPE
} from '../src/main/sessions/config';
import { sealSecret, type Sealer } from '../src/main/store/crypto-format';
import { createHost, type CredentialSet, type Host } from '../src/shared/types';

const fakeSealer: Sealer = {
  available: () => true,
  seal: (plain) => Buffer.from(`SEALED:${plain}`, 'utf8'),
  unseal: (data) => data.toString('utf8').replace(/^SEALED:/, '')
};

const readKey = (path: string): string => `KEY-FROM-${path}`;

function host(over: Partial<Host> = {}): Host {
  return createHost({ id: 'h1', name: 'X', protocol: 'ssh', host: '10.0.0.1', ...over });
}

function cred(over: Partial<CredentialSet> = {}): CredentialSet {
  return {
    id: 'c1',
    name: 'prod',
    username: 'root',
    passwordMode: 'stored',
    passwordCipher: null,
    keyFile: null,
    keyPassphraseCipher: null,
    useAgent: false,
    ...over
  };
}

describe('resolveAuth', () => {
  it('берёт сохранённый пароль из набора и расшифровывает его', () => {
    const c = cred({ passwordCipher: sealSecret('p@ss', fakeSealer) });
    const auth = resolveAuth(c, undefined, fakeSealer, readKey);
    expect(auth).toEqual({ password: 'p@ss' });
  });

  it('использует SSH-ключ с парольной фразой', () => {
    const c = cred({
      passwordMode: 'ask',
      keyFile: 'C:/keys/id_rsa',
      keyPassphraseCipher: sealSecret('phrase', fakeSealer)
    });
    const auth = resolveAuth(c, undefined, fakeSealer, readKey);
    expect(auth.privateKey).toBe('KEY-FROM-C:/keys/id_rsa');
    expect(auth.passphrase).toBe('phrase');
    expect(auth.password).toBeUndefined();
  });

  it('режим «спрашивать»: без пароля из диалога аутентификации нет', () => {
    const c = cred({ passwordMode: 'ask', passwordCipher: null });
    expect(resolveAuth(c, undefined, fakeSealer, readKey)).toEqual({});
  });

  it('пароль из диалога используется при режиме «спрашивать» и без набора', () => {
    const c = cred({ passwordMode: 'ask', passwordCipher: null });
    expect(resolveAuth(c, 'typed', fakeSealer, readKey)).toEqual({ password: 'typed' });
    expect(resolveAuth(null, 'typed', fakeSealer, readKey)).toEqual({ password: 'typed' });
  });

  it('SSH-агент задаёт путь к агенту Windows', () => {
    const c = cred({ useAgent: true });
    const auth = resolveAuth(c, undefined, fakeSealer, readKey);
    expect(auth.agent).toBe(WINDOWS_SSH_AGENT_PIPE);
  });
});

describe('buildSshConfig', () => {
  it('переносит хост, порт, пользователя и тайминги', () => {
    const cfg = buildSshConfig(
      host({ port: 2222, username: 'dev', ssh: { keepalive: 30, agent: false, timeout: 15 } }),
      { password: 'p' }
    );
    expect(cfg.host).toBe('10.0.0.1');
    expect(cfg.port).toBe(2222);
    expect(cfg.username).toBe('dev');
    expect(cfg.readyTimeout).toBe(15000);
    expect(cfg.keepaliveInterval).toBe(30000);
    expect(cfg.password).toBe('p');
  });

  it('keepalive 0 отключает интервал', () => {
    const cfg = buildSshConfig(host({ ssh: { keepalive: 0, agent: false, timeout: 10 } }), {});
    expect(cfg.keepaliveInterval).toBe(0);
  });

  it('переносит ключ и парольную фразу', () => {
    const cfg = buildSshConfig(host(), { privateKey: 'KEY', passphrase: 'ph' });
    expect(cfg.privateKey).toBe('KEY');
    expect(cfg.passphrase).toBe('ph');
  });
});

describe('buildTelnetConfig', () => {
  it('использует порт 23 по умолчанию и таймаут из хоста', () => {
    const cfg = buildTelnetConfig(host({ protocol: 'telnet' as const }));
    expect(cfg.host).toBe('10.0.0.1');
    expect(cfg.port).toBe(23);
    expect(cfg.negotiationMandatory).toBe(false);
  });
});

describe('effectiveUsername', () => {
  it('пользователь из набора имеет приоритет над пользователем хоста', () => {
    expect(effectiveUsername(host({ username: 'h-user' }), cred({ username: 'c-user' }))).toBe('c-user');
    expect(effectiveUsername(host({ username: 'h-user' }), null)).toBe('h-user');
  });
});
