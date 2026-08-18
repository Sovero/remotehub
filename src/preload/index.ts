import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-contract';
import type { CredentialSet, Settings, TreeNode } from '../shared/types';

const api = {
  getProfiles: (): Promise<{ tree: TreeNode[]; recovered: boolean }> =>
    ipcRenderer.invoke(IPC.profilesGet),
  saveProfiles: (tree: TreeNode[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.profilesSave, tree),
  getSettings: (): Promise<{ settings: Settings; recovered: boolean }> =>
    ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<Settings>): Promise<{ ok: boolean; settings: Settings }> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),
  getCredentials: (): Promise<{ sets: CredentialSet[]; recovered: boolean }> =>
    ipcRenderer.invoke(IPC.credentialsList),
  appInfo: (): Promise<{ version: string; electron: string; platform: string }> =>
    ipcRenderer.invoke(IPC.appInfo),
  onNotify: (cb: (message: string) => void): (() => void) => {
    const listener = (_e: unknown, message: string): void => cb(message);
    ipcRenderer.on(IPC.notify, listener);
    return () => ipcRenderer.removeListener(IPC.notify, listener);
  }
};

export type RendererApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
