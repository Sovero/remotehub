import { join } from 'path';
import {
  SCHEMA_VERSION,
  type CredentialSet,
  type CredentialsFile,
  type ProfilesFile,
  type Settings,
  type SettingsFile,
  type TreeNode
} from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { atomicWriteJson, readJsonSafe } from './atomic';
import type { Sealer } from './crypto-format';

export interface LoadData<T> {
  data: T;
  recovered: boolean;
}

export class SchemaTooNewError extends Error {
  constructor(file: string, found: number, supported: number) {
    super(
      `Файл ${file} создан более новой версией приложения (схема ${found}, поддерживается ${supported}). ` +
        'Обновите приложение или удалите файл вручную.'
    );
    this.name = 'SchemaTooNewError';
  }
}

function checkSchema(file: string, schemaVersion: number | undefined): void {
  if (schemaVersion === undefined) {
    // Файл без версии — считаем схемой 1 (первая версия писала без поля).
    return;
  }
  if (schemaVersion > SCHEMA_VERSION) {
    throw new SchemaTooNewError(file, schemaVersion, SCHEMA_VERSION);
  }
}

export class Store {
  private readonly profilesPath: string;
  private readonly settingsPath: string;
  private readonly credentialsPath: string;

  constructor(
    private readonly dir: string,
    private readonly sealerImpl: Sealer
  ) {
    this.profilesPath = join(dir, 'profiles.json');
    this.settingsPath = join(dir, 'settings.json');
    this.credentialsPath = join(dir, 'credentials.json');
  }

  // ---- profiles ----

  loadProfiles(): LoadData<TreeNode[]> {
    const res = readJsonSafe<ProfilesFile>(this.profilesPath);
    if (res.data !== null) {
      checkSchema(this.profilesPath, res.data.schemaVersion);
    }
    return { data: res.data?.tree ?? [], recovered: res.recovered };
  }

  saveProfiles(tree: TreeNode[]): void {
    const file: ProfilesFile = { schemaVersion: SCHEMA_VERSION, tree };
    atomicWriteJson(this.profilesPath, file);
  }

  // ---- settings ----

  loadSettings(): LoadData<Settings> {
    const res = readJsonSafe<SettingsFile>(this.settingsPath);
    if (res.data !== null) {
      checkSchema(this.settingsPath, res.data.schemaVersion);
    }
    const merged: Settings = { ...DEFAULT_SETTINGS, ...(res.data?.settings ?? {}) };
    return { data: merged, recovered: res.recovered };
  }

  saveSettings(settings: Settings): void {
    const file: SettingsFile = { schemaVersion: SCHEMA_VERSION, settings };
    atomicWriteJson(this.settingsPath, file);
  }

  // ---- credentials ----

  loadCredentials(): LoadData<CredentialSet[]> {
    const res = readJsonSafe<CredentialsFile>(this.credentialsPath);
    if (res.data !== null) {
      checkSchema(this.credentialsPath, res.data.schemaVersion);
    }
    return { data: res.data?.sets ?? [], recovered: res.recovered };
  }

  saveCredentials(sets: CredentialSet[]): void {
    const file: CredentialsFile = { schemaVersion: SCHEMA_VERSION, sets };
    atomicWriteJson(this.credentialsPath, file);
  }

  /** Sealer для шифрования секретов (используется IPC при сохранении наборов). */
  sealer(): Sealer {
    return this.sealerImpl;
  }

  // ---- paths (для тестов и диагностики) ----

  paths(): { profiles: string; settings: string; credentials: string; dir: string } {
    return {
      profiles: this.profilesPath,
      settings: this.settingsPath,
      credentials: this.credentialsPath,
      dir: this.dir
    };
  }
}
