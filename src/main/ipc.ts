import { writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { app } from 'electron';
import { nanoid } from 'nanoid';
import {
  IPC,
  type CredentialSaveResult,
  type CredentialSetInput,
  type ExportResult,
  type ImportResult,
  type RdpLaunchRequest,
  type SessionAuthRequest,
  type SessionOpenRequest
} from '../shared/ipc-contract';
import type { CredentialSet, Settings, TreeNode } from '../shared/types';
import { buildExport, parseProfileExport } from '../shared/tree';
import {
  applyCredentialInput,
  detachCredential,
  toDtoList,
  validateCredentialInput
} from './credentials/dto';
import { RdpManager } from './rdp/manager';
import { SessionManager } from './sessions/manager';
import type { Store } from './store';

export function registerIpc(store: Store, sessions: SessionManager, rdp: RdpManager): void {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload);
    }
  };

  // ---- profiles ----
  ipcMain.handle(IPC.profilesGet, () => {
    const { data, recovered } = store.loadProfiles();
    return { tree: data, recovered };
  });

  ipcMain.handle(IPC.profilesSave, (_e, tree: TreeNode[]) => {
    store.saveProfiles(tree);
    return { ok: true };
  });

  ipcMain.handle(IPC.profilesExport, async (e): Promise<ExportResult> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.SaveDialogOptions = {
      title: 'Экспорт профилей',
      defaultPath: 'remote-hub-profiles.json',
      filters: [{ name: 'Remote Hub profiles', extensions: ['json'] }]
    };
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      const tree = store.loadProfiles().data;
      writeFileSync(filePath, buildExport(tree), 'utf8');
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: `Не удалось записать файл: ${(err as Error).message}` };
    }
  });

  ipcMain.handle(IPC.profilesImport, async (e): Promise<ImportResult> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Импорт профилей',
      properties: ['openFile'],
      filters: [{ name: 'Remote Hub profiles', extensions: ['json'] }]
    };
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
    try {
      const raw = await readFile(filePaths[0], 'utf8');
      const parsed = parseProfileExport(raw);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      return { ok: true, tree: parsed.tree };
    } catch (err) {
      return { ok: false, error: `Не удалось прочитать файл: ${(err as Error).message}` };
    }
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

  // ---- credentials ----
  ipcMain.handle(IPC.credentialsList, () => {
    const { data, recovered } = store.loadCredentials();
    return toDtoList(data, recovered);
  });

  ipcMain.handle(IPC.credentialsSave, (_e, input: CredentialSetInput): CredentialSaveResult => {
    const invalid = validateCredentialInput(input);
    if (invalid) return { ok: false, error: invalid };
    const sets = store.loadCredentials().data;
    const existing = input.id ? (sets.find((c) => c.id === input.id) ?? null) : null;
    const next = applyCredentialInput(existing, input, store.sealer());
    const id = next.id || nanoid(10);
    const saved: CredentialSet = { ...next, id };
    const withoutOld = input.id ? sets.filter((c) => c.id !== input.id) : sets;
    store.saveCredentials([...withoutOld, saved]);
    return { ok: true, id };
  });

  ipcMain.handle(IPC.credentialsDelete, (_e, id: string) => {
    const sets = store.loadCredentials().data.filter((c) => c.id !== id);
    store.saveCredentials(sets);
    // Убрать ссылки на удалённый набор из дерева хостов и вернуть дерево рендереру.
    const tree = detachCredential(store.loadProfiles().data, id);
    store.saveProfiles(tree);
    return { ok: true, tree };
  });

  ipcMain.handle(IPC.dialogPickFile, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Выбор файла ключа',
      properties: ['openFile'],
      filters: [
        { name: 'Ключи', extensions: ['pem', 'key', 'ppk', 'openssh'] },
        { name: 'Все файлы', extensions: ['*'] }
      ]
    };
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (canceled || filePaths.length === 0) return { canceled: true, path: null };
    return { canceled: false, path: filePaths[0] };
  });

  // ---- app info ----
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    platform: process.platform
  }));

  // ---- уведомления из главного процесса ----
  ipcMain.on(IPC.notify, (_e, message: string) => {
    broadcast(IPC.notify, message);
  });

  // ---- сессии ----
  ipcMain.handle(IPC.sessionOpen, (_e, req: SessionOpenRequest) => {
    const credential = req.host.credentialId
      ? store.loadCredentials().data.find((c) => c.id === req.host.credentialId) ?? null
      : null;
    const sessionId = sessions.open({
      host: req.host,
      credential,
      dialogPassword: req.password,
      cols: req.cols ?? 80,
      rows: req.rows ?? 24
    });
    return { sessionId };
  });

  ipcMain.on(IPC.sessionInput, (_e, payload: { sessionId: string; data: string }) => {
    sessions.input(payload.sessionId, Buffer.from(payload.data, 'base64'));
  });

  ipcMain.on(IPC.sessionResize, (_e, payload: { sessionId: string; cols: number; rows: number }) => {
    sessions.resize(payload.sessionId, payload.cols, payload.rows);
  });

  ipcMain.handle(IPC.sessionClose, (_e, sessionId: string) => {
    sessions.close(sessionId);
    rdp.stop(sessionId);
    return { ok: true };
  });

  ipcMain.handle(IPC.sessionAuth, (_e, req: SessionAuthRequest) => {
    sessions.retryWithPassword(req.sessionId, req.password);
    return { ok: true };
  });

  // ---- RDP ----
  ipcMain.handle(IPC.rdpLaunch, (_e, req: RdpLaunchRequest) => {
    const credential = req.host.credentialId
      ? store.loadCredentials().data.find((c) => c.id === req.host.credentialId) ?? null
      : null;
    return rdp.launch(req.host, credential, req.sessionId);
  });
}
