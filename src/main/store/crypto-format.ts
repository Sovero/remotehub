/**
 * Sealer — платформенная часть шифрования. На Windows это DPAPI через
 * safeStorage (см. crypto.ts); в тестах подменяется фейком.
 */
export interface Sealer {
  available(): boolean;
  seal(plain: string): Buffer;
  unseal(data: Buffer): string;
}

const ENC_PREFIX = 'enc:';
const PLAIN_PREFIX = 'plain:';

/**
 * Хранимый формат: `enc:<base64>` — запечатано платформенным шифром;
 * `plain:<base64>` — открытый текст (base64), только когда платформенное
 * шифрование недоступно (не Windows). Настоящие секреты никогда не пишутся
 * в файл как `plain:` на Windows.
 */
export function sealSecret(plain: string, sealer: Sealer): string {
  if (sealer.available()) {
    return ENC_PREFIX + sealer.seal(plain).toString('base64');
  }
  return PLAIN_PREFIX + Buffer.from(plain, 'utf8').toString('base64');
}

export function unsealSecret(cipher: string, sealer: Sealer): string {
  if (cipher.startsWith(ENC_PREFIX)) {
    return sealer.unseal(Buffer.from(cipher.slice(ENC_PREFIX.length), 'base64'));
  }
  if (cipher.startsWith(PLAIN_PREFIX)) {
    return Buffer.from(cipher.slice(PLAIN_PREFIX.length), 'base64').toString('utf8');
  }
  throw new Error('Неизвестный формат шифротекста');
}

export function isCiphertextSecret(value: string): boolean {
  return value.startsWith(ENC_PREFIX) || value.startsWith(PLAIN_PREFIX);
}
