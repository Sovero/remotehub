import type { CredentialSet, Settings, TreeNode } from './types';

export const IPC = {
  profilesGet: 'profiles:get',
  profilesSave: 'profiles:save',
  profilesExport: 'profiles:export',
  profilesImport: 'profiles:import',
  credentialsList: 'credentials:list',
  credentialsSave: 'credentials:save',
  credentialsDelete: 'credentials:delete',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appInfo: 'app:info',
  notify: 'app:notify',
  sessionOpen: 'session:open',
  sessionInput: 'session:input',
  sessionResize: 'session:resize',
  sessionClose: 'session:close',
  sessionData: 'session:data',
  sessionState: 'session:state',
  sftpList: 'sftp:list',
  sftpRead: 'sftp:read',
  sftpWrite: 'sftp:write',
  sftpMkdir: 'sftp:mkdir',
  sftpRename: 'sftp:rename',
  sftpDelete: 'sftp:delete',
  sftpLocalList: 'sftp:local-list',
  tunnelsAdd: 'tunnels:add',
  tunnelsStop: 'tunnels:stop',
  tunnelsList: 'tunnels:list',
  rdpLaunch: 'rdp:launch',
  checkPort: 'check:port',
  checkPing: 'check:ping',
  dialogPickFile: 'dialog:pick-file',
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

export interface CredentialsListResult {
  sets: CredentialSet[];
  recovered: boolean;
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
  | { phase: 'connected' }
  | { phase: 'error'; message: string }
  | { phase: 'closed'; reason?: string };

export interface SessionOpenRequest {
  profile: { id: string; name: string; protocol: string; host: string; port: number | null };
  /** Пароль, введённый пользователем в диалоге (не сохраняется). */
  password?: string;
}
