import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { HostKeyStore, parseHostKey } from '../src/main/sessions/host-keys';

let dir: string;
let filePath: string;
let store: HostKeyStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remotehub-hostkeys-'));
  filePath = join(dir, 'hostkeys.json');
  store = new HostKeyStore(filePath);
});

describe('HostKeyStore', () => {
  it('неизвестный host:port — isKnown false, get null', () => {
    expect(store.isKnown('example.com', 22)).toBe(false);
    expect(store.get('example.com', 22)).toBeNull();
  });

  it('put сохраняет запись, isKnown/get находят её', () => {
    store.put('example.com', 22, 'ssh-ed25519', 'AAA111');
    expect(store.isKnown('example.com', 22)).toBe(true);
    const entry = store.get('example.com', 22);
    expect(entry?.algo).toBe('ssh-ed25519');
    expect(entry?.fingerprint).toBe('AAA111');
    expect(entry?.firstSeenAt).toBeGreaterThan(0);
  });

  it('разные порты одного хоста — независимые записи', () => {
    store.put('example.com', 22, 'ssh-ed25519', 'AAA');
    expect(store.isKnown('example.com', 2222)).toBe(false);
    expect(store.get('example.com', 2222)).toBeNull();
  });

  it('разные хосты на одном порту — независимые записи', () => {
    store.put('a.example.com', 22, 'ssh-ed25519', 'AAA');
    expect(store.isKnown('b.example.com', 22)).toBe(false);
  });

  it('put перезаписывает существующую запись', () => {
    store.put('example.com', 22, 'ssh-ed25519', 'AAA');
    store.put('example.com', 22, 'ssh-rsa', 'BBB');
    const entry = store.get('example.com', 22);
    expect(entry?.algo).toBe('ssh-rsa');
    expect(entry?.fingerprint).toBe('BBB');
  });

  it('hasChanged: false для неизвестного хоста (не спорим — TOFU происходит через put)', () => {
    expect(store.hasChanged('example.com', 22, 'ssh-ed25519', 'AAA')).toBe(false);
  });

  it('hasChanged: false при совпадении алгоритма и отпечатка', () => {
    store.put('example.com', 22, 'ssh-ed25519', 'AAA');
    expect(store.hasChanged('example.com', 22, 'ssh-ed25519', 'AAA')).toBe(false);
  });

  it('hasChanged: true при другом отпечатке (переустановка сервера / MITM)', () => {
    store.put('example.com', 22, 'ssh-ed25519', 'AAA');
    expect(store.hasChanged('example.com', 22, 'ssh-ed25519', 'BBB')).toBe(true);
  });

  it('hasChanged: true при другом алгоритме ключа', () => {
    store.put('example.com', 22, 'ssh-ed25519', 'AAA');
    expect(store.hasChanged('example.com', 22, 'ssh-rsa', 'AAA')).toBe(true);
  });

  it('запись переживает пересоздание HostKeyStore на том же файле', () => {
    store.put('example.com', 22, 'ssh-ed25519', 'AAA');
    const reopened = new HostKeyStore(filePath);
    expect(reopened.isKnown('example.com', 22)).toBe(true);
    expect(reopened.get('example.com', 22)?.fingerprint).toBe('AAA');
  });

  it('пишет валидный JSON без временного файла', () => {
    store.put('example.com', 22, 'ssh-ed25519', 'AAA');
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.entries['example.com:22'].fingerprint).toBe('AAA');
  });

  it('повреждённый файл не роняет чтение — хранилище ведёт себя как пустое', () => {
    writeFileSync(filePath, '{не json', 'utf8');
    expect(store.isKnown('example.com', 22)).toBe(false);
    expect(store.get('example.com', 22)).toBeNull();
  });

  it('отсутствующий файл (первый запуск) — пустое хранилище без исключений', () => {
    expect(() => store.isKnown('example.com', 22)).not.toThrow();
    expect(store.isKnown('example.com', 22)).toBe(false);
  });
});

describe('parseHostKey', () => {
  function encodeKeyBlob(algo: string, payload: Buffer): Buffer {
    const algoBuf = Buffer.from(algo, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(algoBuf.length, 0);
    return Buffer.concat([lenBuf, algoBuf, payload]);
  }

  it('разбирает имя алгоритма из wire-формата ключа', () => {
    const blob = encodeKeyBlob('ssh-ed25519', Buffer.from([1, 2, 3]));
    expect(parseHostKey(blob).algo).toBe('ssh-ed25519');
  });

  it('одинаковый ключ даёт одинаковый отпечаток', () => {
    const blob = encodeKeyBlob('ssh-ed25519', Buffer.from([1, 2, 3]));
    expect(parseHostKey(blob).fingerprint).toBe(parseHostKey(blob).fingerprint);
  });

  it('разные ключи дают разные отпечатки', () => {
    const blob1 = encodeKeyBlob('ssh-ed25519', Buffer.from([1, 2, 3]));
    const blob2 = encodeKeyBlob('ssh-ed25519', Buffer.from([4, 5, 6]));
    expect(parseHostKey(blob1).fingerprint).not.toBe(parseHostKey(blob2).fingerprint);
  });

  it('отпечаток — base64 без padding (без завершающих "=")', () => {
    const blob = encodeKeyBlob('ssh-rsa', Buffer.from('some rsa key material used only for the padding test'));
    expect(parseHostKey(blob).fingerprint.endsWith('=')).toBe(false);
  });
});
