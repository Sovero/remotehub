import { describe, expect, it } from 'vitest';
import {
  isCiphertextSecret,
  sealSecret,
  unsealSecret,
  type Sealer
} from '../src/main/store/crypto-format';

function makeSealer(available: boolean): Sealer {
  return {
    available: () => available,
    seal: (plain) => Buffer.from(`SEALED:${plain}`, 'utf8'),
    unseal: (data) => data.toString('utf8').replace(/^SEALED:/, '')
  };
}

describe('sealSecret / unsealSecret', () => {
  it('круговое шифрование возвращает исходный текст', () => {
    const sealer = makeSealer(true);
    const cipher = sealSecret('SuperSecret!', sealer);
    expect(unsealSecret(cipher, sealer)).toBe('SuperSecret!');
  });

  it('шифротекст не содержит открытый текст', () => {
    const sealer = makeSealer(true);
    const cipher = sealSecret('SuperSecret!', sealer);
    expect(cipher).not.toContain('SuperSecret!');
    expect(cipher.startsWith('enc:')).toBe(true);
  });

  it('при недоступном платформенном шифровании используется plain: с base64', () => {
    const sealer = makeSealer(false);
    const cipher = sealSecret('hello', sealer);
    expect(cipher.startsWith('plain:')).toBe(true);
    expect(cipher).not.toContain('hello');
    expect(unsealSecret(cipher, sealer)).toBe('hello');
  });

  it('кириллица переживает круг', () => {
    const sealer = makeSealer(true);
    const cipher = sealSecret('пароль-с-кириллицей 🔐', sealer);
    expect(unsealSecret(cipher, sealer)).toBe('пароль-с-кириллицей 🔐');
  });

  it('неизвестный формат шифротекста бросает ошибку', () => {
    expect(() => unsealSecret('raw-text', makeSealer(true))).toThrow('Неизвестный формат');
  });

  it('isCiphertextSecret отличает шифротекст от прочего', () => {
    expect(isCiphertextSecret('enc:AAAA')).toBe(true);
    expect(isCiphertextSecret('plain:AAAA')).toBe(true);
    expect(isCiphertextSecret('secret')).toBe(false);
  });
});
