import { createHash } from 'crypto';
import { atomicWriteJson, readJsonSafe } from '../store/atomic';

const SCHEMA_VERSION = 1;

export interface HostKeyEntry {
  algo: string;
  /** SHA256-отпечаток в base64 без padding. Префикс "SHA256:" добавляет только UI при отображении. */
  fingerprint: string;
  firstSeenAt: number;
}

interface HostKeysFile {
  schemaVersion: number;
  entries: Record<string, HostKeyEntry>;
}

function entryKey(host: string, port: number): string {
  return `${host}:${port}`;
}

/**
 * TOFU (trust-on-first-use) хранилище отпечатков SSH host key.
 *
 * Отдельный JSON-файл в userData (обычно `hostkeys.json`) — НЕ расширение
 * ProfilesFile/SettingsFile/CredentialsFile из src/main/store/index.ts,
 * своя схема и свой путь, но та же атомарная запись/безопасное чтение
 * (src/main/store/atomic.ts), что и у остальных файлов в userData.
 *
 * Путь передаётся в конструктор явно (внедряемая зависимость), чтобы
 * юнит-тесты подставляли временный файл вместо реального userData.
 */
export class HostKeyStore {
  constructor(private readonly filePath: string) {}

  private load(): HostKeysFile {
    const res = readJsonSafe<HostKeysFile>(this.filePath);
    return {
      schemaVersion: res.data?.schemaVersion ?? SCHEMA_VERSION,
      entries: res.data?.entries ?? {}
    };
  }

  private save(file: HostKeysFile): void {
    atomicWriteJson(this.filePath, file);
  }

  isKnown(host: string, port: number): boolean {
    return entryKey(host, port) in this.load().entries;
  }

  get(host: string, port: number): HostKeyEntry | null {
    return this.load().entries[entryKey(host, port)] ?? null;
  }

  put(host: string, port: number, algo: string, fingerprint: string): void {
    const file = this.load();
    file.entries[entryKey(host, port)] = { algo, fingerprint, firstSeenAt: Date.now() };
    this.save(file);
  }

  /** true, если для host:port уже есть запись и она отличается по алгоритму или отпечатку. */
  hasChanged(host: string, port: number, algo: string, fingerprint: string): boolean {
    const known = this.get(host, port);
    if (!known) return false;
    return known.algo !== algo || known.fingerprint !== fingerprint;
  }
}

/**
 * Разбирает SSH host key в wire-формате (K_S — то, что ssh2 передаёт в
 * hostVerifier, если не задан hostHash) на имя алгоритма и SHA256-отпечаток
 * в духе `ssh-keygen -lf` (но без префикса "SHA256:" — его добавляет UI).
 */
export function parseHostKey(keyBlob: Buffer): { algo: string; fingerprint: string } {
  const algoLen = keyBlob.readUInt32BE(0);
  const algo = keyBlob.subarray(4, 4 + algoLen).toString('utf8');
  const fingerprint = createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '');
  return { algo, fingerprint };
}
