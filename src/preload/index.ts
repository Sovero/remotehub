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
  type HistoryAddRequest,
  type ImportResult,
  type LocalEntry,
  type MonitorCheckRequest,
  type MonitorCheckResult,
  type RunbookRunRequest,
  type RunbookStepResultPayload,
  type RunbookStopRequest,
  type SessionDataPayload,
  type SessionOpenRequest,
  type SessionStatePayload,
  type SftpEntry,
  type SftpOpenRequest,
  type SftpOpenResult,
  type TransferProgress,
  type TunnelAddRequest,
  type TunnelAddResult,
  type TunnelInfo,
  type UpdateStatus,
  type VncErrorPayload,
  type RdpCertificatePayload
} from '../shared/ipc-contract';
import type { ChangelogEntry } from '../shared/changelog';
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
  getChangelog: (): Promise<{
    ok: boolean;
    entries?: ChangelogEntry[];
    error?: string;
  }> => ipcRenderer.invoke(IPC.appChangelog),
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
  rdpLaunch: (req: { sessionId: string; host: import('../shared/types').Host }): Promise<{
    ok: boolean;
    error?: string;
  }> => ipcRenderer.invoke(IPC.rdpLaunch, req),
  /** Прямоугольник панели RDP-вкладки (CSS-пиксели) — main переведёт в физические. */
  rdpSetRect: (sessionId: string, rect: { x: number; y: number; width: number; height: number }): void =>
    ipcRenderer.send(IPC.rdpRect, { sessionId, rect }),
  /** Переключение вкладок: показать встроенное окно сессии, спрятать остальные. */
  rdpActivate: (sessionId: string): void => ipcRenderer.send(IPC.rdpActivate, sessionId),
  /** Модальный диалог открыт/закрыт: встроенные окна временно прячутся. */
  rdpOverlay: (active: boolean): void => ipcRenderer.send(IPC.rdpOverlay, active),
  rdpAcceptCertificate: (sessionId: string): void => ipcRenderer.send(IPC.rdpCertificateAccept, sessionId),
  rdpRejectCertificate: (sessionId: string): void => ipcRenderer.send(IPC.rdpCertificateReject, sessionId),
  onRdpCertificate: (cb: (payload: RdpCertificatePayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: RdpCertificatePayload): void => cb(payload);
    ipcRenderer.on(IPC.rdpCertificate, listener);
    return () => ipcRenderer.removeListener(IPC.rdpCertificate, listener);
  },
  vncOpen: (req: {
    sessionId: string;
    host: import('../shared/types').Host;
  }): Promise<{ ok: boolean; port?: number; password?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.vncOpen, req),
  vncClose: (sessionId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.vncClose, sessionId),
  /** Ошибка рукопожатия VNC (сервер молчит / не-RFB / неподдерживаемое шифрование). */
  onVncError: (cb: (payload: VncErrorPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: VncErrorPayload): void => cb(payload);
    ipcRenderer.on(IPC.vncError, listener);
    return () => ipcRenderer.removeListener(IPC.vncError, listener);
  },
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
  checkForUpdates: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.updateDownload),
  quitAndInstall: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.updateInstall),
  onUpdateState: (cb: (state: UpdateStatus) => void): (() => void) => {
    const listener = (_e: unknown, payload: { state: UpdateStatus }): void => cb(payload.state);
    ipcRenderer.on(IPC.updateState, listener);
    return () => ipcRenderer.removeListener(IPC.updateState, listener);
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
  },
  // ---- history ----
  getHistory: (): Promise<{ entries: import('../shared/types').HistoryEntry[] }> =>
    ipcRenderer.invoke(IPC.historyGet),
  addHistory: (req: HistoryAddRequest): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.historyAdd, req),
  clearHistory: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.historyClear),
  // ---- runbooks ----
  getRunbooks: (): Promise<{ runbooks: import('../shared/types').Runbook[] }> =>
    ipcRenderer.invoke(IPC.runbooksGet),
  saveRunbook: (runbook: import('../shared/types').Runbook): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.runbooksSave, runbook),
  deleteRunbook: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.runbooksDelete, id),
  runRunbook: (req: RunbookRunRequest): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.runbookRun, req),
  stopRunbook: (req: RunbookStopRequest): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.runbookStop, req),
  onRunbookStepResult: (cb: (payload: RunbookStepResultPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: RunbookStepResultPayload): void => cb(payload);
    ipcRenderer.on(IPC.runbookStepResult, listener);
    return () => ipcRenderer.removeListener(IPC.runbookStepResult, listener);
  },
  // ---- monitoring ----
  monitorCheck: (req: MonitorCheckRequest): Promise<MonitorCheckResult> =>
    ipcRenderer.invoke(IPC.monitorCheck, req),
  monitorCheckAll: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.monitorCheckAll),
  // ---- rdpjs (node-rdpjs) ----
  rdpjsLaunch: (req: import('../shared/ipc-contract').RdpjsLaunchRequest): Promise<import('../shared/ipc-contract').RdpjsLaunchResult> =>
    ipcRenderer.invoke(IPC.rdpjsLaunch, req),
  rdpjsClose: (sessionId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.rdpjsClose, sessionId),
  rdpjsMouse: (sessionId: string, x: number, y: number, button: number, isPressed: boolean): void =>
    ipcRenderer.send(IPC.rdpjsMouse, { sessionId, x, y, button, isPressed }),
  rdpjsMouseMove: (sessionId: string, x: number, y: number): void =>
    ipcRenderer.send(IPC.rdpjsMouseMove, { sessionId, x, y }),
  rdpjsWheel: (sessionId: string, x: number, y: number, step: number, isNegative: boolean, isHorizontal: boolean): void =>
    ipcRenderer.send(IPC.rdpjsWheel, { sessionId, x, y, step, isNegative, isHorizontal }),
  rdpjsKeyUnicode: (sessionId: string, code: number, isPressed: boolean): void =>
    ipcRenderer.send(IPC.rdpjsKeyUnicode, { sessionId, code, isPressed }),
  rdpjsKeyScancode: (sessionId: string, code: number, isPressed: boolean): void =>
    ipcRenderer.send(IPC.rdpjsKeyScancode, { sessionId, code, isPressed }),
  onRdpjsBitmap: (cb: (payload: import('../shared/ipc-contract').RdpjsBitmapPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: import('../shared/ipc-contract').RdpjsBitmapPayload): void => cb(payload);
    ipcRenderer.on(IPC.rdpjsBitmap, listener);
    return () => ipcRenderer.removeListener(IPC.rdpjsBitmap, listener);
  },
  onRdpjsState: (cb: (payload: import('../shared/ipc-contract').RdpjsStatePayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: import('../shared/ipc-contract').RdpjsStatePayload): void => cb(payload);
    ipcRenderer.on(IPC.rdpjsState, listener);
    return () => ipcRenderer.removeListener(IPC.rdpjsState, listener);
  },
  offRdpjsBitmap: (cb: (...args: unknown[]) => void): void => {
    ipcRenderer.removeListener(IPC.rdpjsBitmap, cb as (...args: unknown[]) => void);
  },
  offRdpjsState: (cb: (...args: unknown[]) => void): void => {
    ipcRenderer.removeListener(IPC.rdpjsState, cb as (...args: unknown[]) => void);
  }
};

export type RendererApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
