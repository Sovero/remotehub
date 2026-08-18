import { BrowserWindow, ipcMain } from 'electron';
import { app } from 'electron';
import { IPC } from '../shared/ipc-contract';
import type { Settings, TreeNode } from '../shared/types';
import type { Store } from './store';

export function registerIpc(store: Store): void {
  // ---- profiles ----
  ipcMain.handle(IPC.profilesGet, () => {
    const { data, recovered } = store.loadProfiles();
    return { tree: data, recovered };
  });

  ipcMain.handle(IPC.profilesSave, (_e, tree: TreeNode[]) => {
    store.saveProfiles(tree);
    return { ok: true };
  });

  // ---- settings ----
  ipcMain.handle(IPC.settingsGet, () => {
    const { data, recovered } = store.loadSettings();
    return { settings: data, recovered };
  });

  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<Settings>) => {
    const current = store.loadSettings().data;
    const next: Settings = { ...current, ...patch };
    store.saveSettings(next);
    return { ok: true, settings: next };
  });

  // ---- app info ----
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    platform: process.platform
  }));

  // ---- уведомления из главного процесса ----
  ipcMain.on(IPC.notify, (_e, message: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.notify, message);
    }
  });
}
