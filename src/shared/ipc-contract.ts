import type { CredentialSet, Settings, TreeNode, HistoryEntry, Runbook, RunbookStep } from './types';

export const IPC = {
  profilesGet: 'profiles:get',
  profilesSave: 'profiles:save',
  profilesExport: 'profiles:export',
  profilesImport: 'profiles:import',
  credentialsList: 'credentials:list',
  credentialsSave: 'credentials:save',
  credentialsDelete: 'credentials:delete',
  dialogPickFile: 'dialog:pick-file',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appInfo: 'app:info',
  appChangelog: 'app:changelog',
  notify: 'app:notify',
  menuCommand: 'menu:command',
  sessionOpen: 'session:open',
  sessionInput: 'session:input',
  sessionResize: 'session:resize',
  sessionClose: 'session:close',
  sessionAuth: 'session:auth',
  sessionData: 'session:data',
  sessionState: 'session:state',
  vncOpen: 'vnc:open',
  vncClose: 'vnc:close',
  vncError: 'vnc:error',
  sftpOpen: 'sftp:open',
  sftpClose: 'sftp:close',
  sftpList: 'sftp:list',
  sftpLocalList: 'sftp:local-list',
  sftpDownload: 'sftp:download',
  sftpUpload: 'sftp:upload',
  sftpMkdir: 'sftp:mkdir',
  sftpRename: 'sftp:rename',
  sftpDelete: 'sftp:delete',
  sftpProgress: 'sftp:progress',
  localFsMkdir: 'fs:mkdir',
  localFsRename: 'fs:rename',
  localFsDelete: 'fs:delete',
  tunnelsAdd: 'tunnels:add',
  tunnelsStop: 'tunnels:stop',
  tunnelsList: 'tunnels:list',
  /** node-rdpjs: битмап из main в renderer */
  rdpjsBitmap: 'rdpjs:bitmap',
  /** node-rdpjs: состояние сессии */
  rdpjsState: 'rdpjs:state',
  /** Единый поток состояний всех RDP-движков (iron|rdpjs|legacy) — RdpEngineStatePayload */
  engineState: 'rdp:engine-state',
  /** Единый поток состояний всех RDP-движков (см. src/shared/rdp-engine.ts). */
  rdpEngineState: 'rdp:engine-state',
  /** node-rdpjs: события мыши из renderer */
  rdpjsMouse: 'rdpjs:mouse',
  /** node-rdpjs: движение мыши */
  rdpjsMouseMove: 'rdpjs:mouse-move',
  /** node-rdpjs: колёсико */
  rdpjsWheel: 'rdpjs:wheel',
  /** node-rdpjs: клавиша (юникод) */
  rdpjsKeyUnicode: 'rdpjs:key-unicode',
  /** node-rdpjs: клавиша (сканкод) */
  rdpjsKeyScancode: 'rdpjs:key-scancode',
  /** iron (IronRDP/WASM): запуск локального RDCleanPath-моста для сессии */
  ironStart: 'iron:start',
  /** iron: остановка моста */
  ironStop: 'iron:stop',
  /** legacy (MsRdpClient ActiveX): запуск встроенной сессии */
  rdpLegacyLaunch: 'rdp-legacy:launch',
  /** legacy: остановка сессии */
  rdpLegacyStop: 'rdp-legacy:stop',
  /** legacy: прямоугольник панели вкладки (CSS px) → встраиваемое окно */
  rdpLegacyRect: 'rdp-legacy:rect',
  /** legacy: переключение вкладок — показать активную, спрятать остальные */
  rdpLegacyActivate: 'rdp-legacy:activate',
  /** legacy: спрятать окно конкретной сессии (вкладка стала неактивной) */
  rdpLegacyHide: 'rdp-legacy:hide',
  /** legacy: модальный диалог открыт/закрыт — временно прятать/показывать встроенные окна */
  rdpLegacyOverlay: 'rdp-legacy:overlay',
  /** legacy: сессия завершилась (main → renderer) */
  rdpLegacyExited: 'rdp-legacy:exited',
  /** node-rdpjs: запуск сессии */
  rdpjsLaunch: 'rdpjs:launch',
  /** node-rdpjs: закрытие сессии */
  rdpjsClose: 'rdpjs:close',
  updateState: 'update:state',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  checkPort: 'check:port',
  checkPing: 'check:ping',
  checkCancel: 'check:cancel',
  quickConnect: 'quick:connect',
  historyGet: 'history:get',
  historyAdd: 'history:add',
  historyClear: 'history:clear',
  runbooksGet: 'runbooks:get',
  runbooksSave: 'runbooks:save',
  runbooksDelete: 'runbooks:delete',
  runbookRun: 'runbook:run',
  runbookStop: 'runbook:stop',
  runbookStepResult: 'runbook:step-result',
  monitorCheck: 'monitor:check',
  monitorCheckAll: 'monitor:check-all',
  /** журнал событий: получить текущие записи */
  logsGet: 'logs:get',
  /** журнал событий: очистить */
  logsClear: 'logs:clear',
  /** журнал событий: экспорт в файл */
  logsExport: 'logs:export',
  /** журнал событий: запись из renderer в main */
  logAdd: 'log:add',
  /** журнал событий: новая запись (main → окна) */
  logEntry: 'log:entry'
} as const;

export interface ProfilesGetResult {
  tree: TreeNode[];
  recovered: boolean;
}

export interface SettingsGetResult {
  settings: Settings;
  recovered: boolean;
}

/** Набор учётных данных для рендерера: секреты никогда не покидают main. */
export interface CredentialDto {
  id: string;
  name: string;
  username: string;
  passwordMode: 'stored' | 'ask';
  hasPassword: boolean;
  keyFile: string | null;
  hasPassphrase: boolean;
  useAgent: boolean;
}

export interface CredentialsListResult {
  sets: CredentialDto[];
  recovered: boolean;
}

/** Вход для сохранения набора: пароль/фраза приходят открытым текстом и шифруются в main. */
export interface CredentialSetInput {
  id?: string;
  name: string;
  username: string;
  passwordMode: 'stored' | 'ask';
  password?: string;
  clearPassword?: boolean;
  keyFile?: string | null;
  keyPassphrase?: string;
  clearPassphrase?: boolean;
  useAgent?: boolean;
}

export interface CredentialSaveResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  /** Реальная разрядность сборки: x64, ia32, arm64 (не process.platform — он всегда win32). */
  arch: string;
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
  | { phase: 'auth-required'; detail?: string }
  | { phase: 'connected' }
  | { phase: 'error'; message: string }
  | { phase: 'closed'; reason?: string };

export interface SessionOpenRequest {
  /** Id, сгенерированный рендерером; main использует его, чтобы не менять key вкладки. */
  sessionId?: string;
  host: import('./types').Host;
  /** Пароль, введённый пользователем в диалоге (не сохраняется). */
  password?: string;
  cols?: number;
  rows?: number;
}

export interface SessionDataPayload {
  sessionId: string;
  data: string; // base64
}

export interface SessionStatePayload {
  sessionId: string;
  state: SessionState;
}

/**
 * Ответ пользователя на диалог auth-required: либо пароль (keyboard-interactive/
 * ручной ввод), либо решение по host key сервера (см. SessionState 'auth-required'
 * с detail вида "host-key:new:..." / "host-key:changed:..." — HostKeyStore/SshSession).
 */
export type SessionAuthRequest =
  | { sessionId: string; password: string }
  | { sessionId: string; hostKeyDecision: 'accept' | 'reject' };

/** Состояние автообновления, которое main шлёт в рендерер. */
export type UpdateStatus =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; releaseNotes?: string }
  | { status: 'not-available' }
  | { status: 'downloading'; percent: number; bytesPerSecond: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string };

export interface UpdateStatePayload {
  state: UpdateStatus;
}

// ---- legacy (MsRdpClient ActiveX, встроенный HWND) ----

export interface RdpLegacyLaunchRequest {
  sessionId: string;
  host: import('./types').Host;
}

export interface RdpLegacyLaunchResult {
  ok: boolean;
  error?: string;
}

export interface RdpLegacyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RdpLegacyRectRequest {
  sessionId: string;
  rect: RdpLegacyRect;
}

export interface RdpLegacyExitedPayload {
  sessionId: string;
  code: number | null;
  error?: string;
}

export interface VncOpenRequest {
  sessionId: string;
  host: import('./types').Host;
}

export interface VncOpenResult {
  ok: boolean;
  port?: number;
  password?: string;
  error?: string;
}

/** Ошибка рукопожатия VNC, распознанная мостом в main (сервер молчит / не-RFB / шифрование). */
export interface VncErrorPayload {
  sessionId: string;
  message: string;
}

export interface SftpEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
}

export interface LocalEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
}

export interface SftpOpenRequest {
  sessionId: string;
  host: import('./types').Host;
}

export interface SftpOpenResult {
  ok: boolean;
  home?: string;
  error?: string;
}

export interface TransferProgress {
  sessionId: string;
  opId: string;
  direction: 'download' | 'upload';
  name: string;
  transferred: number;
  total: number;
  done: boolean;
  error?: string;
}

export interface TunnelInfo {
  id: string;
  localPort: number;
  targetHost: string;
  targetPort: number;
  active: boolean;
  error?: string;
}

export interface TunnelAddRequest {
  sessionId: string;
  host: import('./types').Host;
  localPort: number;
  targetHost: string;
  targetPort: number;
}

export interface TunnelAddResult {
  ok: boolean;
  tunnel?: TunnelInfo;
  error?: string;
}

/** Результат проверки доступности (check:port / check:ping). */
export interface CheckResult {
  ok: boolean;
  /** Время ответа в миллисекундах. */
  ms?: number;
  error?: string;
  /** Проверка была отменена до завершения. */
  canceled?: boolean;
}

export interface CheckPortRequest {
  host: string;
  port: number;
  /** Идентификатор проверки — по нему рендерер может отменить проверку. */
  requestId?: string;
}

export interface CheckPingRequest {
  host: string;
  requestId?: string;
}

export interface CheckCancelRequest {
  requestIds: string[];
}

// ---- iron (@devolutions/iron-remote-desktop через локальный мост) ----

export interface IronStartRequest {
  sessionId: string;
  host: string;
  port?: number;
  domain?: string;
  credentialId?: string | null;
}

/**
 * Результат запуска моста. Пароль возвращается в renderer осознанно:
 * WASM-клиент IronRDP выполняет NLA сам, серверной стороны у него нет.
 * Секрет разрешён в main из хранилища (credentialId) и никуда дальше не идёт.
 */
export interface IronStartResult {
  ok: boolean;
  /**
   * WebSocket-адрес локального RDCleanPath-моста с одноразовым токеном сессии
   * (ws://127.0.0.1:<port>/?token=<секрет>). Токен проверяется мостом при
   * upgrade; тот же секрет надо передать в SessionBuilder.authToken (proxy_auth
   * Request PDU) — мост сверяет и его. Секрет сессии: в логи не писать.
   */
  wsUrl?: string;
  /** Одноразовый токен этой сессии моста — для SessionBuilder.authToken. */
  authToken?: string;
  /** Строка destination для Request PDU (host:port реального сервера). */
  destination?: string;
  username?: string;
  password?: string;
  domain?: string;
  error?: string;
}

// ---- history ----

export interface HistoryAddRequest {
  entry: Omit<import('./types').HistoryEntry, 'id'>;
}

// ---- runbooks ----

export interface RunbookRunRequest {
  runbookId: string;
  hostId: string;
  password?: string;
}

export interface RunbookStepResultPayload {
  runbookId: string;
  hostId: string;
  stepId: string;
  ok: boolean;
  output: string;
  error?: string;
}

export interface RunbookStopRequest {
  runbookId: string;
  hostId: string;
}

// ---- monitoring ----

export interface MonitorCheckRequest {
  hostId: string;
  host: string;
  port: number;
}

export interface MonitorCheckResult {
  ok: boolean;
  ms?: number;
  error?: string;
}

// ---- журнал событий ----

export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'app' | 'rdp' | 'iron' | 'vnc' | 'ssh' | 'telnet' | 'update' | 'sftp' | 'system';

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  source: LogSource;
  message: string;
}

export interface LogAddRequest {
  level: LogLevel;
  source: LogSource;
  message: string;
}

export interface LogsExportRequest {
  /** Готовый текст журнала (уже отфильтрован рендерером), построчно. */
  text: string;
}

export interface LogsExportResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

// ---- rdpjs (node-rdpjs) ----

export interface RdpjsLaunchRequest {
  sessionId: string;
  host: string;
  port?: number;
  username: string;
  password: string;
  credentialId?: string | null;
  domain?: string;
  width?: number;
  height?: number;
}

export interface RdpjsLaunchResult {
  ok: boolean;
  error?: string;
}

export interface RdpjsBitmapPayload {
  sessionId: string;
  destLeft: number;
  destTop: number;
  width: number;
  height: number;
  /** Raw BGRA pixel data as ArrayBuffer (transferable). */
  data: ArrayBuffer;
}

export interface RdpjsStatePayload {
  sessionId: string;
  state: 'connecting' | 'connected' | 'disconnected';
  error?: string;
}

export interface RdpjsMouseEvent {
  sessionId: string;
  x: number;
  y: number;
  button: number;
  isPressed: boolean;
}

export interface RdpjsMouseMoveEvent {
  sessionId: string;
  x: number;
  y: number;
}

export interface RdpjsWheelEvent {
  sessionId: string;
  x: number;
  y: number;
  step: number;
  isNegative: boolean;
  isHorizontal: boolean;
}

export interface RdpjsKeyEvent {
  sessionId: string;
  code: number;
  isPressed: boolean;
}
