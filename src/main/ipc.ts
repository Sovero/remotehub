import { mkdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, join, posix } from 'path';
import { BrowserWindow, dialog, ipcMain, screen } from 'electron';
import { app } from 'electron';
import { nanoid } from 'nanoid';
import {
  IPC,
  type CheckCancelRequest,
  type CheckPingRequest,
  type CheckPortRequest,
  type CredentialSaveResult,
  type CredentialSetInput,
  type ExportResult,
  type ImportResult,
  type RdpLaunchRequest,
  type RdpRectRequest,
  type SessionAuthRequest,
  type SessionOpenRequest,
  type SftpOpenRequest,
  type TunnelAddRequest,
  type VncOpenRequest
} from '../shared/ipc-contract';
import type { CredentialSet, Settings, TreeNode, HistoryEntry, Runbook, HostStatus } from '../shared/types';
import { parseChangelog } from '../shared/changelog';
import { buildExport, parseProfileExport } from '../shared/tree';
import { checkPort, pingHost } from './availability';
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
import { Updater } from './updater';
import type { Store } from './store';

export function registerIpc(
  store: Store,
  sessions: SessionManager,
  rdp: RdpManager,
  vnc: VncManager,
  sftp: SftpManager,
  tunnels: TunnelManager,
  updater: Updater
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
    // Настройка RDP применяется к живым менеджеру сразу, без перезапуска.
    if ('rdpAutoAcceptCert' in patch) {
      rdp.setAutoAcceptCert(next.rdpAutoAcceptCert);
    }
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
    // process.platform всегда 'win32' даже на 64-битной Windows; показываем реальную разрядность.
    arch: process.arch
  }));

  // Записи changelog: читаются из CHANGELOG.md. Путь от __dirname (out/main):
  // в dev и смоуке — ../../CHANGELOG.md (корень проекта), в asar-сборке —
  // app.asar/CHANGELOG.md (файл включён в files electron-builder).
  ipcMain.handle(IPC.appChangelog, async () => {
    try {
      const changelogPath = join(__dirname, '..', '..', 'CHANGELOG.md');
      const markdown = await readFile(changelogPath, 'utf8');
      return { ok: true, entries: parseChangelog(markdown) };
    } catch (err) {
      return { ok: false, error: `Не удалось прочитать CHANGELOG.md: ${(err as Error).message}` };
    }
  });

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

  // Прямоугольник панели вкладки (CSS-пиксели) → физические пиксели и в менеджер.
  ipcMain.on(IPC.rdpRect, (e, req: RdpRectRequest) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    const sf = screen.getDisplayMatching(win.getBounds()).scaleFactor;
    rdp.setRect(req.sessionId, {
      x: Math.round(req.rect.x * sf),
      y: Math.round(req.rect.y * sf),
      width: Math.round(req.rect.width * sf),
      height: Math.round(req.rect.height * sf)
    });
  });

  // Переключение вкладок: показать окно активной RDP-сессии, спрятать остальные.
  ipcMain.on(IPC.rdpActivate, (_e, sessionId: string) => {
    rdp.activate(sessionId);
  });

  ipcMain.on(IPC.rdpCertificateAccept, (_e, sessionId: string) => {
    rdp.acceptCertificate(sessionId);
  });

  ipcMain.on(IPC.rdpCertificateReject, (_e, sessionId: string) => {
    rdp.rejectCertificate(sessionId);
  });

  // Открытие/закрытие модального диалога: встроенные окна временно прячутся.
  ipcMain.on(IPC.rdpOverlay, (_e, overlay: boolean) => {
    rdp.setOverlay(overlay);
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
    let filePath: string;
    if (process.env.RH_SMOKE === '1') {
      // Смоук: нативный диалог не показываем, сохраняем в temp.
      filePath = join(app.getPath('temp'), `rh-sftp-dl-${nanoid(8)}-${basename(req.remotePath)}`);
    } else {
      const options: Electron.SaveDialogOptions = {
        title: 'Сохранить как',
        defaultPath: basename(req.remotePath),
        filters: [{ name: 'Все файлы', extensions: ['*'] }]
      };
      const { canceled, filePath: fp } = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (canceled || !fp) return { ok: false, canceled: true };
      filePath = fp;
    }
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

  // ---- проверка доступности ----
  const activeChecks = new Map<string, AbortController>();

  ipcMain.handle(IPC.checkPort, async (_e, req: CheckPortRequest) => {
    const controller = req.requestId ? new AbortController() : null;
    if (controller && req.requestId) activeChecks.set(req.requestId, controller);
    try {
      return await checkPort(req.host, req.port, undefined, controller?.signal);
    } finally {
      if (req.requestId) activeChecks.delete(req.requestId);
    }
  });

  ipcMain.handle(IPC.checkPing, async (_e, req: CheckPingRequest) => {
    const controller = req.requestId ? new AbortController() : null;
    if (controller && req.requestId) activeChecks.set(req.requestId, controller);
    try {
      return await pingHost(req.host, undefined, controller?.signal);
    } finally {
      if (req.requestId) activeChecks.delete(req.requestId);
    }
  });

  ipcMain.handle(IPC.checkCancel, (_e, req: CheckCancelRequest) => {
    for (const id of req.requestIds) activeChecks.get(id)?.abort();
    return { ok: true };
  });

  // ---- история ----
  ipcMain.handle(IPC.historyGet, () => {
    const { data } = store.loadSettings();
    return { entries: data.history ?? [] };
  });

  ipcMain.handle(IPC.historyAdd, (_e, req: { entry: Omit<HistoryEntry, 'id'> }) => {
    const { nanoid } = require('nanoid');
    const entry: HistoryEntry = { ...req.entry, id: nanoid(10) };
    const current = store.loadSettings().data;
    const history = [entry, ...(current.history ?? [])].slice(0, 500);
    store.saveSettings({ ...current, history });
    return { ok: true };
  });

  ipcMain.handle(IPC.historyClear, () => {
    const current = store.loadSettings().data;
    store.saveSettings({ ...current, history: [] });
    return { ok: true };
  });

  // ---- runbooks ----
  ipcMain.handle(IPC.runbooksGet, () => {
    const { data } = store.loadSettings();
    return { runbooks: data.runbooks ?? [] };
  });

  ipcMain.handle(IPC.runbooksSave, (_e, runbook: Runbook) => {
    const current = store.loadSettings().data;
    const runbooks = [...(current.runbooks ?? [])];
    const idx = runbooks.findIndex((r) => r.id === runbook.id);
    if (idx >= 0) runbooks[idx] = runbook;
    else runbooks.push(runbook);
    store.saveSettings({ ...current, runbooks });
    return { ok: true };
  });

  ipcMain.handle(IPC.runbooksDelete, (_e, id: string) => {
    const current = store.loadSettings().data;
    const runbooks = (current.runbooks ?? []).filter((r) => r.id !== id);
    store.saveSettings({ ...current, runbooks });
    return { ok: true };
  });

  // Активные runbook-сессии: runbookId+hostId → sessionId
  const activeRunbooks = new Map<string, string>();

  ipcMain.handle(IPC.runbookRun, async (_e, req: { runbookId: string; hostId: string; password?: string }) => {
    const { data } = store.loadSettings();
    const runbook = (data.runbooks ?? []).find((r) => r.id === req.runbookId);
    if (!runbook) return { ok: false, error: 'Runbook не найден' };
    const key = `${req.runbookId}:${req.hostId}`;
    if (activeRunbooks.has(key)) return { ok: false, error: 'Runbook уже выполняется' };

    // Находим хост в дереве
    const { data: tree } = store.loadProfiles();
    const node = tree.flatMap(function flatten(n: any): any[] {
      return n.kind === 'group' ? (n.children ?? []).flatMap(flatten) : [n];
    }).find((n: any) => n.id === req.hostId);
    if (!node || node.kind !== 'host') return { ok: false, error: 'Хост не найден' };

    // Запускаем SSH-сессию для каждого шага
    const credential = node.credentialId
      ? store.loadCredentials().data.find((c) => c.id === node.credentialId) ?? null
      : null;

    const sessionId = `runbook-${req.runbookId}-${req.hostId}-${Date.now()}`;
    activeRunbooks.set(key, sessionId);

    // Запускаем сессию — команды будут буферизованы и выполнены при подключении
    sessions.open({
      id: sessionId,
      host: node,
      credential,
      dialogPassword: req.password,
      cols: 200,
      rows: 50
    });

    // Выполняем шаги последовательно в фоне с задержкой
    void (async () => {
      // Начальная задержка для подключения
      await new Promise((resolve) => setTimeout(resolve, 2000));
      for (const step of runbook.steps) {
        if (!activeRunbooks.has(key)) break;
        try {
          const cmd = step.command.trim() + '\n';
          sessions.input(sessionId, Buffer.from(cmd));
          // Даём время на выполнение (5 секунд на шаг)
          await new Promise((resolve) => setTimeout(resolve, 5000));
          broadcast(IPC.runbookStepResult, {
            runbookId: req.runbookId,
            hostId: req.hostId,
            stepId: step.id,
            ok: true,
            output: `[выполнено: ${step.name}]`
          });
        } catch (err) {
          broadcast(IPC.runbookStepResult, {
            runbookId: req.runbookId,
            hostId: req.hostId,
            stepId: step.id,
            ok: false,
            output: '',
            error: (err as Error).message
          });
        }
      }
      activeRunbooks.delete(key);
      sessions.close(sessionId);
    })();

    return { ok: true };
  });

  ipcMain.handle(IPC.runbookStop, (_e, req: { runbookId: string; hostId: string }) => {
    const key = `${req.runbookId}:${req.hostId}`;
    const sessionId = activeRunbooks.get(key);
    if (sessionId) {
      sessions.close(sessionId);
      activeRunbooks.delete(key);
    }
    return { ok: true };
  });

  // ---- мониторинг ----
  ipcMain.handle(IPC.monitorCheck, async (_e, req: { hostId: string; host: string; port: number }) => {
    const [portRes, pingRes] = await Promise.all([
      checkPort(req.host, req.port),
      pingHost(req.host)
    ]);
    const ok = portRes.ok || pingRes.ok;
    return { ok, ms: portRes.ms ?? pingRes.ms, error: ok ? undefined : (portRes.error ?? pingRes.error) };
  });

  ipcMain.handle(IPC.monitorCheckAll, async () => {
    const { data: tree } = store.loadProfiles();
    const hosts = tree.flatMap(function flatten(n: any): any[] {
      return n.kind === 'group' ? (n.children ?? []).flatMap(flatten) : [n];
    }).filter((n: any) => n.kind === 'host');

    const current = store.loadSettings().data;
    const statuses: HostStatus[] = [];
    const now = new Date().toISOString();

    // Проверяем хосты параллельно (пакетами по 4)
    const queue = [...hosts];
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const host = queue.shift();
        if (!host) break;
        const portNum = host.port ?? (host.protocol === 'rdp' ? 3389 : host.protocol === 'ssh' ? 22 : host.protocol === 'vnc' ? 5900 : 23);
        const portRes = await checkPort(host.host, portNum);
        const pingRes = await pingHost(host.host);
        const ok = portRes.ok || pingRes.ok;
        statuses.push({
          hostId: host.id,
          status: ok ? 'ok' : 'fail',
          lastCheckedAt: now,
          lastOkAt: ok ? now : null,
          lastFailAt: ok ? null : now,
          lastMs: portRes.ms ?? pingRes.ms ?? null,
          lastError: ok ? null : (portRes.error ?? pingRes.error ?? null)
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, hosts.length) }, () => worker()));

    // Обновляем статусы в настройках
    store.saveSettings({ ...current, hostStatuses: statuses });
    return { ok: true };
  });

  // ---- автообновление ----
  ipcMain.handle(IPC.updateCheck, async () => {
    await updater.check(true);
    return { ok: true };
  });

  ipcMain.handle(IPC.updateDownload, async () => {
    await updater.download();
    return { ok: true };
  });

  ipcMain.handle(IPC.updateInstall, () => {
    updater.quitAndInstall();
    return { ok: true };
  });
}
