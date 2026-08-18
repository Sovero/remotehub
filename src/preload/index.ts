import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type CredentialDto,
  type CredentialSaveResult,
  type CredentialSetInput,
  type ExportResult,
  type ImportResult,
  type SessionDataPayload,
  type SessionOpenRequest,
  type SessionStatePayload
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
  appInfo: (): Promise<{ version: string; electron: string; platform: string }> =>
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
  onRdpExited: (cb: (payload: { sessionId: string; code: number | null; error?: string }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { sessionId: string; code: number | null; error?: string }): void =>
      cb(payload);
    ipcRenderer.on(IPC.rdpExited, listener);
    return () => ipcRenderer.removeListener(IPC.rdpExited, listener);
  },
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
