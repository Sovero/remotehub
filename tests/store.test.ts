import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store, SchemaTooNewError } from '../src/main/store';
import { sealSecret, type Sealer } from '../src/main/store/crypto-format';
import {
  createGroup,
  createHost,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  type CredentialSet
} from '../src/shared/types';

const fakeSealer: Sealer = {
  available: () => true,
  seal: (plain) => Buffer.from(`SEALED:${plain}`, 'utf8'),
  unseal: (data) => data.toString('utf8').replace(/^SEALED:/, '')
};

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remotehub-store-'));
  store = new Store(dir, fakeSealer);
});

afterEach(() => {
  // Папка во временной директории — чистить не обязательно, но чисто.
  void dir;
});

describe('profiles', () => {
  it('сохраняет и загружает дерево профилей', () => {
    const tree = [
      createGroup({ id: 'g1', name: 'Серверы' , children: [
        createHost({ id: 'h1', name: 'Prod', protocol: 'ssh', host: '10.0.0.1' })
      ]})
    ];
    store.saveProfiles(tree);
    const loaded = store.loadProfiles();
    expect(loaded.recovered).toBe(false);
    expect(loaded.data).toEqual(tree);
  });

  it('при отсутствии файла возвращает пустое дерево', () => {
    const loaded = store.loadProfiles();
    expect(loaded.data).toEqual([]);
  });

  it('пишет файл атомарно: временный файл не остаётся', () => {
    store.saveProfiles([createHost({ id: 'h1', name: 'X', protocol: 'ssh', host: 'h' })]);
    const files = readdirSync(dir);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(files).toContain('profiles.json');
  });

  it('повреждённый файл откладывается в .bak и возвращается пустое дерево', () => {
    writeFileSync(join(dir, 'profiles.json'), '{не json', 'utf8');
    const loaded = store.loadProfiles();
    expect(loaded.recovered).toBe(true);
    expect(loaded.data).toEqual([]);
    const backups = readdirSync(dir).filter((f) => f.startsWith('profiles.json.bak-'));
    expect(backups.length).toBe(1);
  });

  it('файл от более новой версии приложения даёт понятную ошибку', () => {
    writeFileSync(
      join(dir, 'profiles.json'),
      JSON.stringify({ schemaVersion: SCHEMA_VERSION + 5, tree: [] }),
      'utf8'
    );
    expect(() => store.loadProfiles()).toThrow(SchemaTooNewError);
  });

  it('файл без поля версии читается как схема 1', () => {
    writeFileSync(
      join(dir, 'profiles.json'),
      JSON.stringify({ tree: [createHost({ id: 'h1', name: 'Old', protocol: 'ssh', host: 'h' })] }),
      'utf8'
    );
    const loaded = store.loadProfiles();
    expect(loaded.recovered).toBe(false);
    expect(loaded.data).toHaveLength(1);
  });
});

describe('settings', () => {
  it('возвращает настройки по умолчанию при отсутствии файла', () => {
    const loaded = store.loadSettings();
    expect(loaded.data).toEqual(DEFAULT_SETTINGS);
  });

  it('дополняет частичные настройки значениями по умолчанию', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS, fontSize: 16 });
    const loaded = store.loadSettings();
    expect(loaded.data.fontSize).toBe(16);
    expect(loaded.data.theme).toBe('dark');
  });

  it('повреждённый файл настроек откладывается в .bak', () => {
    writeFileSync(join(dir, 'settings.json'), '%%%', 'utf8');
    const loaded = store.loadSettings();
    expect(loaded.recovered).toBe(true);
    expect(loaded.data).toEqual(DEFAULT_SETTINGS);
  });
});

describe('credentials', () => {
  it('хранит шифротексты как есть и возвращает их же', () => {
    const sets: CredentialSet[] = [
      {
        id: 'c1',
        name: 'prod',
        username: 'root',
        passwordMode: 'stored',
        passwordCipher: sealSecret('p@ss', fakeSealer),
        keyFile: null,
        keyPassphraseCipher: null,
        useAgent: false
      }
    ];
    store.saveCredentials(sets);
    const loaded = store.loadCredentials();
    expect(loaded.data).toEqual(sets);
    expect(loaded.data[0].passwordCipher).toContain('enc:');
  });

  it('открытый текст пароля не попадает в файл', () => {
    store.saveCredentials([
      {
        id: 'c1',
        name: 'prod',
        username: 'root',
        passwordMode: 'stored',
        passwordCipher: sealSecret('p@ss', fakeSealer),
        keyFile: null,
        keyPassphraseCipher: null,
        useAgent: false
      }
    ]);
    const raw = readFileSync(join(dir, 'credentials.json'), 'utf8');
    expect(raw).not.toContain('p@ss');
  });
});

describe('paths', () => {
  it('возвращает пути в userData', () => {
    const p = store.paths();
    expect(p.dir).toBe(dir);
    expect(existsSync(p.dir)).toBe(true);
  });
});
