import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type CheckPingRequest,
  type CheckPortRequest,
  type CheckResult,
  type CredentialDto,
  type CredentialSaveResult,
  type CredentialSetInput,
  type ExportResult,
  type ImportResult,
  type LocalEntry,
  type SessionDataPayload,
  type SessionOpenRequest,
  type SessionStatePayload,
  type SftpEntry,
  type SftpOpenRequest,
  type SftpOpenResult,
  type TransferProgress,
  type TunnelAddRequest,
  type TunnelAddResult,
  type TunnelInfo
} from '../shared/ipc-contract';
import type { Settings, TreeNode } from '../shared/types';

const api = {
  getProfiles: (): Promise<{ tree: TreeNode[]; recovered: boolean }> =>
    ipcRenderer.invoke(IPC.profilesGet),
  saveProfiles: (tree: TreeNode[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.profilesSave, tree),
  exportProfiles: (): Promise<ExportResult> => ipcRenderer.invoke(IPC.profilesExport),
  importProfiles: (): Promise<ImportResult> => ipcRenderer.invoke(IPC.profilesImport),
  getSettings: (): Promise<{ settings: Settings; recovered: boolean }> =>
    ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<Settings>): Promise<{ ok: boolean; settings: Settings }> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),
  getCredentials: (): Promise<{ sets: CredentialDto[]; recovered: boolean }> =>
    ipcRenderer.invoke(IPC.credentialsList),
  saveCredential: (input: CredentialSetInput): Promise<CredentialSaveResult> =>
    ipcRenderer.invoke(IPC.credentialsSave, input),
  deleteCredential: (id: string): Promise<{ ok: boolean; tree?: TreeNode[] }> =>
    ipcRenderer.invoke(IPC.credentialsDelete, id),
  pickKeyFile: (): Promise<{ canceled: boolean; path: string | null }> =>
    ipcRenderer.invoke(IPC.dialogPickFile),
  appInfo: (): Promise<{ version: string; electron: string; arch: string }> =>
    ipcRenderer.invoke(IPC.appInfo),
  onNotify: (cb: (message: string) => void): (() => void) => {
    const listener = (_e: unknown, message: string): void => cb(message);
    ipcRenderer.on(IPC.notify, listener);
    return () => ipcRenderer.removeListener(IPC.notify, listener);
  },
  onMenuCommand: (cb: (command: string) => void): (() => void) => {
    const listener = (_e: unknown, command: string): void => cb(command);
    ipcRenderer.on(IPC.menuCommand, listener);
    return () => ipcRenderer.removeListener(IPC.menuCommand, listener);
  },
  openSession: (req: SessionOpenRequest): Promise<{ sessionId: string }> =>
    ipcRenderer.invoke(IPC.sessionOpen, req),
  sessionInput: (sessionId: string, data: string): void =>
    ipcRenderer.send(IPC.sessionInput, { sessionId, data }),
  sessionResize: (sessionId: string, cols: number, rows: number): void =>
    ipcRenderer.send(IPC.sessionResize, { sessionId, cols, rows }),
  sessionClose: (sessionId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.sessionClose, sessionId),
  sessionAuth: (sessionId: string, password: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.sessionAuth, { sessionId, password }),
  rdpLaunch: (req: { sessionId: string; host: import('../shared/types').Host }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.rdpLaunch, req),
  vncOpen: (req: {
    sessionId: string;
    host: import('../shared/types').Host;
  }): Promise<{ ok: boolean; port?: number; password?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.vncOpen, req),
  vncClose: (sessionId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.vncClose, sessionId),
  sftpOpen: (req: SftpOpenRequest): Promise<SftpOpenResult> => ipcRenderer.invoke(IPC.sftpOpen, req),
  sftpClose: (sessionId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.sftpClose, sessionId),
  sftpList: (sessionId: string, path: string): Promise<{ ok: boolean; entries?: SftpEntry[]; error?: string }> =>
    ipcRenderer.invoke(IPC.sftpList, { sessionId, path }),
  sftpLocalList: (path: string): Promise<{ ok: boolean; entries?: LocalEntry[]; error?: string }> =>
    ipcRenderer.invoke(IPC.sftpLocalList, path),
  sftpDownload: (sessionId: string, remotePath: string): Promise<{ ok: boolean; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.sftpDownload, { sessionId, remotePath }),
  sftpUpload: (sessionId: string, remoteDir: string): Promise<{ ok: boolean; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.sftpUpload, { sessionId, remoteDir }),
  sftpMkdir: (sessionId: string, path: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.sftpMkdir, { sessionId, path }),
  sftpRename: (sessionId: string, from: string, to: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.sftpRename, { sessionId, from, to }),
  sftpDelete: (sessionId: string, path: string, isDir: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.sftpDelete, { sessionId, path, isDir }),
  localFsMkdir: (path: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.localFsMkdir, path),
  localFsRename: (from: string, to: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.localFsRename, { from, to }),
  localFsDelete: (path: string, isDir: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.localFsDelete, { path, isDir }),
  tunnelsAdd: (req: TunnelAddRequest): Promise<TunnelAddResult> => ipcRenderer.invoke(IPC.tunnelsAdd, req),
  tunnelsStop: (sessionId: string, tunnelId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.tunnelsStop, { sessionId, tunnelId }),
  tunnelsList: (sessionId: string): Promise<{ ok: boolean; tunnels: TunnelInfo[] }> =>
    ipcRenderer.invoke(IPC.tunnelsList, sessionId),
  onSftpProgress: (cb: (p: TransferProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: TransferProgress): void => cb(p);
    ipcRenderer.on(IPC.sftpProgress, listener);
    return () => ipcRenderer.removeListener(IPC.sftpProgress, listener);
  },
  onRdpExited: (cb: (payload: { sessionId: string; code: number | null; error?: string }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { sessionId: string; code: number | null; error?: string }): void =>
      cb(payload);
    ipcRenderer.on(IPC.rdpExited, listener);
    return () => ipcRenderer.removeListener(IPC.rdpExited, listener);
  },
  checkPort: (req: CheckPortRequest): Promise<CheckResult> => ipcRenderer.invoke(IPC.checkPort, req),
  checkPing: (req: CheckPingRequest): Promise<CheckResult> => ipcRenderer.invoke(IPC.checkPing, req),
  checkCancel: (requestIds: string[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.checkCancel, { requestIds }),
  onSessionData: (cb: (payload: SessionDataPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: SessionDataPayload): void => cb(payload);
    ipcRenderer.on(IPC.sessionData, listener);
    return () => ipcRenderer.removeListener(IPC.sessionData, listener);
  },
  onSessionState: (cb: (payload: SessionStatePayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: SessionStatePayload): void => cb(payload);
    ipcRenderer.on(IPC.sessionState, listener);
    return () => ipcRenderer.removeListener(IPC.sessionState, listener);
  }
};

export type RendererApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
