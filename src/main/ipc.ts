import { mkdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, posix } from 'path';
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
  type SessionOpenRequest,
  type SftpOpenRequest,
  type TunnelAddRequest,
  type VncOpenRequest
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
import { SftpManager } from './sftp/manager';
import { TunnelManager } from './tunnels/manager';
import { VncManager } from './vnc/manager';
import type { Store } from './store';

export function registerIpc(
  store: Store,
  sessions: SessionManager,
  rdp: RdpManager,
  vnc: VncManager,
  sftp: SftpManager,
  tunnels: TunnelManager
): void {
  const resolveCredential = (host: { credentialId?: string | null }): CredentialSet | null =>
    host.credentialId ? store.loadCredentials().data.find((c) => c.id === host.credentialId) ?? null : null;
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
      id: req.sessionId,
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
    vnc.close(sessionId);
    sftp.close(sessionId);
    tunnels.stopAll(sessionId);
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

  // ---- VNC ----
  ipcMain.handle(IPC.vncOpen, async (_e, req: VncOpenRequest) => {
    const credential = req.host.credentialId
      ? store.loadCredentials().data.find((c) => c.id === req.host.credentialId) ?? null
      : null;
    return vnc.open(req.host, credential, req.sessionId);
  });

  ipcMain.handle(IPC.vncClose, (_e, sessionId: string) => {
    vnc.close(sessionId);
    return { ok: true };
  });

  // ---- SFTP ----
  ipcMain.handle(IPC.sftpOpen, async (_e, req: SftpOpenRequest) => {
    const credential = resolveCredential(req.host);
    const res = await sftp.open(req.host, credential, req.sessionId);
    if (!res.ok) return res;
    return { ok: true, home: app.getPath('home') };
  });

  ipcMain.handle(IPC.sftpClose, (_e, sessionId: string) => {
    sftp.close(sessionId);
    return { ok: true };
  });

  ipcMain.handle(IPC.sftpList, async (_e, req: { sessionId: string; path: string }) => {
    try {
      const entries = await sftp.list(req.sessionId, req.path);
      return { ok: true, entries };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.sftpMkdir, async (_e, req: { sessionId: string; path: string }) => {
    try {
      await sftp.mkdir(req.sessionId, req.path);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.sftpRename, async (_e, req: { sessionId: string; from: string; to: string }) => {
    try {
      await sftp.rename(req.sessionId, req.from, req.to);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.sftpDelete, async (_e, req: { sessionId: string; path: string; isDir: boolean }) => {
    try {
      await sftp.remove(req.sessionId, req.path, req.isDir);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.sftpDownload, async (e, req: { sessionId: string; remotePath: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.SaveDialogOptions = {
      title: 'Сохранить как',
      defaultPath: basename(req.remotePath),
      filters: [{ name: 'Все файлы', extensions: ['*'] }]
    };
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return { ok: false, canceled: true };
    const opId = nanoid(8);
    try {
      await sftp.download(req.sessionId, req.remotePath, filePath, (p) => broadcast(IPC.sftpProgress, p), opId);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: `Скачивание прервано: ${(err as Error).message} — частичный файл не является целым`
      };
    }
  });

  ipcMain.handle(IPC.sftpUpload, async (e, req: { sessionId: string; remoteDir: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Файл для загрузки',
      properties: ['openFile']
    };
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
    const localPath = filePaths[0];
    const remotePath = posix.join(req.remoteDir.replace(/\\/g, '/'), basename(localPath));
    const opId = nanoid(8);
    try {
      await sftp.upload(req.sessionId, localPath, remotePath, (p) => broadcast(IPC.sftpProgress, p), opId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Загрузка прервана: ${(err as Error).message}` };
    }
  });

  // ---- локальная файловая система (для панели SFTP) ----
  ipcMain.handle(IPC.sftpLocalList, (_e, req: { path: string }) => {
    const path = req.path || app.getPath('home');
    try {
      return { ok: true, entries: sftp.localList(path) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.localFsMkdir, (_e, path: string) => {
    try {
      mkdirSync(path);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.localFsRename, (_e, req: { from: string; to: string }) => {
    try {
      renameSync(req.from, req.to);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.localFsDelete, (_e, req: { path: string; isDir: boolean }) => {
    try {
      if (req.isDir) rmdirSync(req.path);
      else unlinkSync(req.path);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // ---- туннели ----
  ipcMain.handle(IPC.tunnelsAdd, async (_e, req: TunnelAddRequest) => {
    const credential = resolveCredential(req.host);
    return tunnels.add(req.sessionId, req.host, credential, req.localPort, req.targetHost, req.targetPort);
  });

  ipcMain.handle(IPC.tunnelsStop, (_e, req: { sessionId: string; tunnelId: string }) => {
    tunnels.stop(req.sessionId, req.tunnelId);
    return { ok: true };
  });

  ipcMain.handle(IPC.tunnelsList, (_e, sessionId: string) => {
    return { ok: true, tunnels: tunnels.list(sessionId) };
  });
}
