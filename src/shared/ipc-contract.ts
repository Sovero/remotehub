import type { CredentialSet, Settings, TreeNode } from './types';

export const IPC = {
  profilesGet: 'profiles:get',
  profilesSave: 'profiles:save',
  profilesExport: 'profiles:export',
  profilesImport: 'profiles:import',
  credentialsList: 'credentials:list',
  credentialsSave: 'credentials:save',
  credentialsDelete: 'credentials:delete',
  dialogPickFile: 'dialog:pick-file',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appInfo: 'app:info',
  notify: 'app:notify',
  menuCommand: 'menu:command',
  sessionOpen: 'session:open',
  sessionInput: 'session:input',
  sessionResize: 'session:resize',
  sessionClose: 'session:close',
  sessionAuth: 'session:auth',
  sessionData: 'session:data',
  sessionState: 'session:state',
  vncOpen: 'vnc:open',
  vncClose: 'vnc:close',
  sftpOpen: 'sftp:open',
  sftpClose: 'sftp:close',
  sftpList: 'sftp:list',
  sftpLocalList: 'sftp:local-list',
  sftpDownload: 'sftp:download',
  sftpUpload: 'sftp:upload',
  sftpMkdir: 'sftp:mkdir',
  sftpRename: 'sftp:rename',
  sftpDelete: 'sftp:delete',
  sftpProgress: 'sftp:progress',
  localFsMkdir: 'fs:mkdir',
  localFsRename: 'fs:rename',
  localFsDelete: 'fs:delete',
  tunnelsAdd: 'tunnels:add',
  tunnelsStop: 'tunnels:stop',
  tunnelsList: 'tunnels:list',
  rdpLaunch: 'rdp:launch',
  rdpExited: 'rdp:exited',
  checkPort: 'check:port',
  checkPing: 'check:ping',
  checkCancel: 'check:cancel',
  quickConnect: 'quick:connect'
} as const;

export interface ProfilesGetResult {
  tree: TreeNode[];
  recovered: boolean;
}

export interface SettingsGetResult {
  settings: Settings;
  recovered: boolean;
}

/** Набор учётных данных для рендерера: секреты никогда не покидают main. */
export interface CredentialDto {
  id: string;
  name: string;
  username: string;
  passwordMode: 'stored' | 'ask';
  hasPassword: boolean;
  keyFile: string | null;
  hasPassphrase: boolean;
  useAgent: boolean;
}

export interface CredentialsListResult {
  sets: CredentialDto[];
  recovered: boolean;
}

/** Вход для сохранения набора: пароль/фраза приходят открытым текстом и шифруются в main. */
export interface CredentialSetInput {
  id?: string;
  name: string;
  username: string;
  passwordMode: 'stored' | 'ask';
  password?: string;
  clearPassword?: boolean;
  keyFile?: string | null;
  keyPassphrase?: string;
  clearPassphrase?: boolean;
  useAgent?: boolean;
}

export interface CredentialSaveResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  platform: string;
}

export interface ExportResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

export interface ImportResult {
  ok: boolean;
  tree?: TreeNode[];
  canceled?: boolean;
  error?: string;
}

export interface LoadResult<T> {
  data: T;
  recovered: boolean;
}

/** Session states pushed from main to renderer. */
export type SessionState =
  | { phase: 'connecting'; detail?: string }
  | { phase: 'auth-required'; detail?: string }
  | { phase: 'connected' }
  | { phase: 'error'; message: string }
  | { phase: 'closed'; reason?: string };

export interface SessionOpenRequest {
  /** Id, сгенерированный рендерером; main использует его, чтобы не менять key вкладки. */
  sessionId?: string;
  host: import('./types').Host;
  /** Пароль, введённый пользователем в диалоге (не сохраняется). */
  password?: string;
  cols?: number;
  rows?: number;
}

export interface SessionDataPayload {
  sessionId: string;
  data: string; // base64
}

export interface SessionStatePayload {
  sessionId: string;
  state: SessionState;
}

export interface SessionAuthRequest {
  sessionId: string;
  password: string;
}

export interface RdpLaunchRequest {
  sessionId: string;
  host: import('./types').Host;
}

export interface RdpExitedPayload {
  sessionId: string;
  code: number | null;
  error?: string;
}

export interface VncOpenRequest {
  sessionId: string;
  host: import('./types').Host;
}

export interface VncOpenResult {
  ok: boolean;
  port?: number;
  password?: string;
  error?: string;
}

export interface SftpEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
}

export interface LocalEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
}

export interface SftpOpenRequest {
  sessionId: string;
  host: import('./types').Host;
}

export interface SftpOpenResult {
  ok: boolean;
  home?: string;
  error?: string;
}

export interface TransferProgress {
  sessionId: string;
  opId: string;
  direction: 'download' | 'upload';
  name: string;
  transferred: number;
  total: number;
  done: boolean;
  error?: string;
}

export interface TunnelInfo {
  id: string;
  localPort: number;
  targetHost: string;
  targetPort: number;
  active: boolean;
  error?: string;
}

export interface TunnelAddRequest {
  sessionId: string;
  host: import('./types').Host;
  localPort: number;
  targetHost: string;
  targetPort: number;
}

export interface TunnelAddResult {
  ok: boolean;
  tunnel?: TunnelInfo;
  error?: string;
}

/** Результат проверки доступности (check:port / check:ping). */
export interface CheckResult {
  ok: boolean;
  /** Время ответа в миллисекундах. */
  ms?: number;
  error?: string;
  /** Проверка была отменена до завершения. */
  canceled?: boolean;
}

export interface CheckPortRequest {
  host: string;
  port: number;
  /** Идентификатор проверки — по нему рендерер может отменить проверку. */
  requestId?: string;
}

export interface CheckPingRequest {
  host: string;
  requestId?: string;
}

export interface CheckCancelRequest {
  requestIds: string[];
}
