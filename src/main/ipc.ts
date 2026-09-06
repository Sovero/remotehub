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
  type RdpjsLaunchRequest,
  type RdpjsMouseEvent,
  type RdpjsMouseMoveEvent,
  type RdpjsWheelEvent,
  type RdpjsKeyEvent,
  type SessionAuthRequest,
  type SessionOpenRequest,
  type SftpOpenRequest,
  type TunnelAddRequest,
  type VncOpenRequest,
  type IronStartRequest,
  type LogAddRequest,
  type LogsExportRequest,
  type LogsExportResult,
  type RdpLegacyLaunchRequest,
  type RdpLegacyRectRequest
} from '../shared/ipc-contract';
import type { CredentialSet, Settings, TreeNode, HistoryEntry, Runbook, HostStatus } from '../shared/types';
import { parseChangelog } from '../shared/changelog';
import { addLog, clearLogs, getLogs, onLog } from './log';
import { resolveAuth } from './sessions/config';
import type { RdpEngineHub } from './rdp/engine-hub';
import type { RdpEngineConnectRequest } from '../shared/rdp-engine';
import type { RdpManager } from './rdp/manager';
import { readFileSync } from 'fs';
import { buildExport, parseProfileExport } from '../shared/tree';
import { checkPort, pingHost } from './availability';
import {
  applyCredentialInput,
  detachCredential,
  toDtoList,
  validateCredentialInput
} from './credentials/dto';
import { RdpjsClientManager } from './rdp/rdpjs-client';
import { SessionManager } from './sessions/manager';
import { SftpManager } from './sftp/manager';
import { TunnelManager } from './tunnels/manager';
import { VncManager } from './vnc/manager';
import { Updater } from './updater';
import type { Store } from './store';

export function registerIpc(
  store: Store,
  sessions: SessionManager,
  vnc: VncManager,
  sftp: SftpManager,
  tunnels: TunnelManager,
  updater: Updater,
  rdpjs: RdpjsClientManager,
  rdpLegacy: RdpManager,
  engineHub: RdpEngineHub
): void {
  const resolveCredential = (host: { credentialId?: string | null }): CredentialSet | null =>
    host.credentialId ? store.loadCredentials().data.find((c) => c.id === host.credentialId) ?? null : null;
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload);
    }
  };

  // ---- журнал событий: новые записи main → все окна ----
  onLog((entry) => broadcast(IPC.logEntry, entry));

  ipcMain.handle(IPC.logsGet, () => ({ entries: getLogs() }));

  ipcMain.handle(IPC.logsClear, () => {
    clearLogs();
    return { ok: true };
  });

  ipcMain.handle(IPC.logsExport, async (e, req: LogsExportRequest): Promise<LogsExportResult> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.SaveDialogOptions = {
      title: 'Экспорт журнала',
      defaultPath: 'remote-hub-log.txt',
      filters: [{ name: 'Текстовый файл', extensions: ['txt'] }]
    };
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      writeFileSync(filePath, req.text, 'utf8');
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: `Не удалось записать файл: ${(err as Error).message}` };
    }
  });

  // Записи из renderer (переходы состояний сессий, ошибки UI) попадают в тот же журнал.
  ipcMain.on(IPC.logAdd, (_e, req: LogAddRequest) => {
    addLog(req.level, req.source, req.message);
  });

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
    const rdpEngine = patch.rdpEngine === 'iron' || patch.rdpEngine === 'rdpjs' ? patch.rdpEngine : current.rdpEngine;
    const next: Settings = { ...current, ...patch, rdpEngine };
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
    const source = req.host.protocol === 'ssh' || req.host.protocol === 'telnet' ? req.host.protocol : 'system';
    addLog('info', source, `Открытие сессии ${req.host.host}:${req.host.port ?? (req.host.protocol === 'ssh' ? 22 : 23)}`);
    return { sessionId };
  });

  ipcMain.on(IPC.sessionInput, (_e, payload: { sessionId: string; data: string }) => {
    sessions.input(payload.sessionId, Buffer.from(payload.data, 'base64'));
  });

  ipcMain.on(IPC.sessionResize, (_e, payload: { sessionId: string; cols: number; rows: number }) => {
    sessions.resize(payload.sessionId, payload.cols, payload.rows);
  });

  ipcMain.handle(IPC.sessionClose, async (_e, sessionId: string) => {
    sessions.close(sessionId);
    // Закрываем РОВНО движок-владелец сессии (раньше здесь дёргались disconnect
    // всех трёх RDP-движков подряд на каждую сессию — латентный кросс-движковый баг).
    engineHub.disconnect(sessionId);
    vnc.close(sessionId);
    sftp.close(sessionId);
    tunnels.stopAll(sessionId);
    addLog('info', 'system', `Сессия ${sessionId} закрыта`);
    return { ok: true };
  });

  ipcMain.handle(IPC.sessionAuth, (_e, req: SessionAuthRequest) => {
    if ('hostKeyDecision' in req) {
      sessions.resolveHostKey(req.sessionId, req.hostKeyDecision === 'accept');
    } else {
      sessions.retryWithPassword(req.sessionId, req.password);
    }
    return { ok: true };
  });

  // ---- RDPJS (node-rdpjs) ----
  ipcMain.handle(IPC.rdpjsLaunch, async (_e, req: RdpjsLaunchRequest) => {
    // Разрешаем credentials: если передан credentialId, берём пароль из хранилища.
    let username = req.username;
    let password = req.password;
    if (req.credentialId && !password) {
      const cred = store.loadCredentials().data.find((c) => c.id === req.credentialId);
      if (cred) {
        username = cred.username || username;
        const auth = resolveAuth(cred, undefined, store.sealer(), (p) => readFileSync(p, 'utf8'));
        password = auth.password ?? '';
      }
    }
    // Через хаб: успех фиксирует владельца сессии (engine attribution),
    // closeTab/sessionClose потом закроют ровно этот движок.
    const norm: RdpEngineConnectRequest = {
      sessionId: req.sessionId,
      engine: 'rdpjs',
      host: req.host,
      port: req.port,
      username,
      password,
      domain: req.domain,
      width: req.width,
      height: req.height
    };
    return await engineHub.connect(norm);
  });

  ipcMain.handle(IPC.rdpjsClose, (_e, sessionId: string) => {
    engineHub.disconnect(sessionId);
    return { ok: true };
  });

  ipcMain.on(IPC.rdpjsMouse, (_e, event: RdpjsMouseEvent) => {
    engineHub.sendMouse(event.sessionId, event.x, event.y, event.button, event.isPressed);
  });

  ipcMain.on(IPC.rdpjsMouseMove, (_e, event: RdpjsMouseMoveEvent) => {
    engineHub.sendMouseMove(event.sessionId, event.x, event.y);
  });

  ipcMain.on(IPC.rdpjsWheel, (_e, event: RdpjsWheelEvent) => {
    engineHub.sendWheel(event.sessionId, event.x, event.y, event.step, event.isNegative, event.isHorizontal);
  });

  ipcMain.on(IPC.rdpjsKeyUnicode, (_e, event: RdpjsKeyEvent) => {
    engineHub.sendKeyUnicode(event.sessionId, event.code, event.isPressed);
  });

  ipcMain.on(IPC.rdpjsKeyScancode, (_e, event: RdpjsKeyEvent) => {
    engineHub.sendKeyScancode(event.sessionId, event.code, event.isPressed);
  });

  // ---- iron (локальный RDCleanPath-мост для @devolutions/iron-remote-desktop) ----
  ipcMain.handle(IPC.ironStart, async (_e, req: IronStartRequest) => {
    // Секрет разрешается здесь: пароль хранилища уходит только в ответ этой сессии.
    let username = '';
    let password = '';
    let domain: string | undefined = req.domain;
    if (req.credentialId) {
      const cred = store.loadCredentials().data.find((c) => c.id === req.credentialId);
      if (cred) {
        username = cred.username || '';
        const auth = resolveAuth(cred, undefined, store.sealer(), (p) => readFileSync(p, 'utf8'));
        password = auth.password ?? '';
      }
    }
    const norm: RdpEngineConnectRequest = {
      sessionId: req.sessionId,
      engine: 'iron',
      host: req.host,
      port: req.port ?? 3389,
      username,
      password,
      domain
    };
    const res = await engineHub.connect(norm);
    // res.bridge.wsUrl уже содержит одноразовый токен сессии в query
    // (ws://127.0.0.1:<port>/?token=…), authToken — тот же секрет отдельно
    // для SessionBuilder.authToken. В лог — только host:port реального
    // сервера, сам токен не пишем (секрет сессии).
    if (!res.ok) {
      addLog('error', 'iron', `IronRDP: не удалось поднять мост — ${res.error ?? 'неизвестная ошибка'}`);
      return { ok: false, error: res.error ?? 'Не удалось поднять RDCleanPath-мост' };
    }
    addLog('info', 'iron', `IronRDP: мост для ${req.host}:${req.port ?? 3389} поднят (127.0.0.1, доступ по токену сессии)`);
    return { ok: true, ...(res.bridge as NonNullable<typeof res.bridge>) };
  });

  ipcMain.handle(IPC.ironStop, async (_e, sessionId: string) => {
    // Через хаб: закрывает движок-владелец сессии (для iron — мост).
    const engine = engineHub.engineOf(sessionId);
    engineHub.disconnect(sessionId);
    addLog('info', 'iron', `IronRDP: сессия ${sessionId}${engine ? ` (движок ${engine})` : ''} остановлена`);
    return { ok: true };
  });

  // ---- legacy (MsRdpClient ActiveX, встроенный HWND — запасной движок для
  // серверов с сертификатом, несовместимым с TLS-стеком IronRDP) ----
  ipcMain.handle(IPC.rdpLegacyLaunch, async (_e, req: RdpLegacyLaunchRequest) => {
    const credential = resolveCredential(req.host);
    // Через хаб: успех фиксирует владельца сессии (legacy), ввод/оконные
    // команды потом маршрутизируются по capability-флагам движка.
    const res = await engineHub.connect({
      sessionId: req.sessionId,
      engine: 'legacy',
      host: req.host.host,
      port: req.host.port ?? 3389,
      hostProfile: req.host,
      credential
    });
    addLog(
      res.ok ? 'info' : 'error',
      'rdp',
      res.ok
        ? `RDP (legacy): сессия ${req.sessionId} запущена для ${req.host.host}:${req.host.port ?? 3389}`
        : `RDP (legacy): не удалось запустить сессию ${req.sessionId} — ${res.error ?? 'неизвестная ошибка'}`
    );
    return res;
  });

  ipcMain.on(IPC.rdpLegacyStop, (_e, sessionId: string) => {
    engineHub.disconnect(sessionId);
  });

  // Прямоугольник панели вкладки (CSS-пиксели) → физические пиксели и в менеджер.
  ipcMain.on(IPC.rdpLegacyRect, (e, req: RdpLegacyRectRequest) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    const sf = screen.getDisplayMatching(win.getBounds()).scaleFactor;
    engineHub.setRect(req.sessionId, {
      x: Math.round(req.rect.x * sf),
      y: Math.round(req.rect.y * sf),
      width: Math.round(req.rect.width * sf),
      height: Math.round(req.rect.height * sf)
    });
  });

  // Переключение вкладок: показать окно активной legacy-сессии, спрятать остальные.
  ipcMain.on(IPC.rdpLegacyActivate, (_e, sessionId: string) => {
    engineHub.activate(sessionId);
  });

  ipcMain.on(IPC.rdpLegacyHide, (_e, sessionId: string) => {
    engineHub.hide(sessionId);
  });

  // Модальный диалог/онбординг открыт поверх встроенного нативного окна: пока
  // он виден, окно нужно спрятать — иначе, будучи выше Chromium в Z-порядке,
  // оно перехватывает клики и держит клавиатурный фокус на себе, из-за чего
  // диалоги не закрываются и navigator.clipboard.writeText() падает как
  // "документ не в фокусе".
  ipcMain.on(IPC.rdpLegacyOverlay, (_e, overlay: boolean) => {
    engineHub.setOverlay(overlay);
  });

  // ---- VNC ----
  ipcMain.handle(IPC.vncOpen, async (_e, req: VncOpenRequest) => {
    const credential = req.host.credentialId
      ? store.loadCredentials().data.find((c) => c.id === req.host.credentialId) ?? null
      : null;
    const res = await vnc.open(req.host, credential, req.sessionId);
    addLog(
      res.ok ? 'info' : 'error',
      'vnc',
      res.ok
        ? `VNC: подключение к ${req.host.host}:${req.host.port ?? 5900} (порт моста ${res.port ?? '?'})`
        : `VNC: ошибка подключения к ${req.host.host}:${req.host.port ?? 5900} — ${res.error ?? 'неизвестно'}`
    );
    return res;
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
