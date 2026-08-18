import { describe, expect, it } from 'vitest';
import {
  applyCredentialInput,
  detachCredential,
  toDto,
  toDtoList,
  validateCredentialInput
} from '../src/main/credentials/dto';
import { sealSecret, unsealSecret, type Sealer } from '../src/main/store/crypto-format';
import { createGroup, createHost, type CredentialSet } from '../src/shared/types';

const fakeSealer: Sealer = {
  available: () => true,
  seal: (plain) => Buffer.from(`SEALED:${plain}`, 'utf8'),
  unseal: (data) => data.toString('utf8').replace(/^SEALED:/, '')
};

function set(over: Partial<CredentialSet> = {}): CredentialSet {
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

describe('toDto', () => {
  it('не отдаёт шифротексты наружу', () => {
    const dto = toDto(set({ passwordCipher: sealSecret('p@ss', fakeSealer) }));
    expect(dto.hasPassword).toBe(true);
    expect(JSON.stringify(dto)).not.toContain('p@ss');
    expect('passwordCipher' in dto).toBe(false);
  });

  it('показывает наличие ключа и парольной фразы', () => {
    const dto = toDto(set({ keyFile: 'C:/k/id_rsa', keyPassphraseCipher: sealSecret('ph', fakeSealer) }));
    expect(dto.keyFile).toBe('C:/k/id_rsa');
    expect(dto.hasPassphrase).toBe(true);
  });

  it('toDtoList сохраняет флаг recovered', () => {
    const res = toDtoList([set()], true);
    expect(res.recovered).toBe(true);
    expect(res.sets).toHaveLength(1);
  });
});

describe('applyCredentialInput', () => {
  it('шифрует новый пароль и хранит только шифротекст', () => {
    const result = applyCredentialInput(null, { name: 'prod', username: 'root', passwordMode: 'stored', password: 'secret1' }, fakeSealer);
    expect(result.passwordCipher).toContain('enc:');
    expect(unsealSecret(result.passwordCipher!, fakeSealer)).toBe('secret1');
    expect(JSON.stringify(result)).not.toContain('secret1');
  });

  it('режим «спрашивать» не сохраняет пароль', () => {
    const result = applyCredentialInput(set({ passwordCipher: sealSecret('old', fakeSealer) }), {
      name: 'prod',
      username: 'root',
      passwordMode: 'ask'
    }, fakeSealer);
    expect(result.passwordCipher).toBeNull();
  });

  it('при редактировании без пароля сохраняет прежний шифротекст', () => {
    const existing = set({ passwordCipher: sealSecret('old', fakeSealer) });
    const result = applyCredentialInput(existing, { id: 'c1', name: 'prod2', username: 'root', passwordMode: 'stored' }, fakeSealer);
    expect(unsealSecret(result.passwordCipher!, fakeSealer)).toBe('old');
    expect(result.name).toBe('prod2');
  });

  it('clearPassword стирает пароль', () => {
    const existing = set({ passwordCipher: sealSecret('old', fakeSealer) });
    const result = applyCredentialInput(existing, { id: 'c1', name: 'prod', username: 'root', passwordMode: 'stored', clearPassword: true }, fakeSealer);
    expect(result.passwordCipher).toBeNull();
  });

  it('сохраняет файл ключа и парольную фразу', () => {
    const result = applyCredentialInput(null, {
      name: 'k',
      username: 'root',
      passwordMode: 'stored',
      keyFile: 'C:/keys/id_rsa',
      keyPassphrase: 'phrase'
    }, fakeSealer);
    expect(result.keyFile).toBe('C:/keys/id_rsa');
    expect(unsealSecret(result.keyPassphraseCipher!, fakeSealer)).toBe('phrase');
  });
});

describe('validateCredentialInput', () => {
  it('требует имя', () => {
    expect(validateCredentialInput({ name: '  ', username: '', passwordMode: 'stored' })).not.toBeNull();
    expect(validateCredentialInput({ name: 'ok', username: '', passwordMode: 'stored' })).toBeNull();
  });
});

describe('detachCredential', () => {
  it('снимает ссылку на удалённый набор со всех хостов', () => {
    const tree = [
      createHost({ id: 'h1', name: 'A', protocol: 'ssh', host: 'a', credentialId: 'c1' }),
      createGroup({
        id: 'g1',
        name: 'G',
        children: [createHost({ id: 'h2', name: 'B', protocol: 'ssh', host: 'b', credentialId: 'c1' })]
      }),
      createHost({ id: 'h3', name: 'C', protocol: 'ssh', host: 'c', credentialId: 'other' })
    ];
    const after = detachCredential(tree, 'c1');
    expect(after[0]).toMatchObject({ id: 'h1', credentialId: null });
    const g1 = after[1] as ReturnType<typeof createGroup>;
    expect(g1.children[0]).toMatchObject({ id: 'h2', credentialId: null });
    expect(after[2]).toMatchObject({ id: 'h3', credentialId: 'other' });
  });
});
