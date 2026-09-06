import { app, BrowserWindow, dialog, Menu, screen, shell } from 'electron';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { registerIpc } from './ipc';
import { RdpEngineHub } from './rdp/engine-hub';
import type { RdpLegacyExitedPayload } from '../shared/ipc-contract';
import { SessionManager } from './sessions/manager';
import { HostKeyStore } from './sessions/host-keys';
import { SftpManager } from './sftp/manager';
import { TunnelManager } from './tunnels/manager';
import { VncManager } from './vnc/manager';
import { Store } from './store';
import { createHost } from '../shared/types';
import { dpapiSealer } from './store/crypto';
import { sealSecret } from './store/crypto-format';
import { Updater } from './updater';
import { RdpjsClientManager } from './rdp/rdpjs-client';
import { RdpManager } from './rdp/manager';
import { installSmokeHooks } from './smoke';
import { addLog } from './log';
import { EngineMetrics } from './rdp/engine-metrics';

// Страховка от падения всего процесса из-за необязательного нативного модуля
// (bufferutil/utf-8-validate у ws, и т.п.) — такой сбой не должен убивать
// всё приложение диалогом Electron «A JavaScript error occurred». Основная
// защита — try/catch внутри самих модулей (ws) плюс явный asarUnpack для их
// .node-файлов; это — последний рубеж, если что-то всё же проскочит.
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err.stack || err.message);
  try {
    writeFileSync(
      join(app.getPath('userData'), 'crash.log'),
      `uncaughtException: ${err.stack || err.message}`
    );
  } catch {
    // userData может быть недоступен на этом этапе — лог в консоль остаётся.
  }
  dialog.showErrorBox(
    'Remote Hub — неожиданная ошибка',
    'Приложение столкнулось с внутренней ошибкой и не может продолжить работу.\n\n' +
      'Подробности сохранены в crash.log рядом с профилем приложения — приложите ' +
      'этот файл, если сообщаете о проблеме.'
  );
  app.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error('[fatal] unhandledRejection:', message);
});

let mainWindow: BrowserWindow | null = null;
let store: Store;

const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

/** Иконка приложения: в окне и в диалогах (в packaged-сборке — внутри app.asar/build). */
const APP_ICON = join(process.resourcesPath, 'build', 'icon.ico');
const DEV_APP_ICON = join(__dirname, '../../build/icon.ico');

const APP_REPOSITORY = 'https://github.com/Sovero/remotehub';

/**
 * Подготавливает одноразовый профиль для opt-in smoke-теста IronRDP.
 * Пароль приходит только из окружения и сохраняется в изолированный userData
 * через тот же sealer, что и обычные учётные данные приложения.
 */
function seedIronRdpSmoke(): boolean {
  if (process.env.RH_SMOKE_RDP_IRON !== '1') return true;

  const host = process.env.RH_RDP_HOST?.trim();
  const username = process.env.RH_RDP_USERNAME?.trim();
  const password = process.env.RH_RDP_PASSWORD;
  const port = Number(process.env.RH_RDP_PORT ?? 3389);
  if (!host || !username || password === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('[smoke] iron RDP: RH_RDP_HOST, RH_RDP_USERNAME, RH_RDP_PASSWORD and a valid RH_RDP_PORT are required');
    return false;
  }

  const credentialId = 'smoke-rdp-iron-credential';
  store.saveCredentials([
    {
      id: credentialId,
      name: 'IronRDP smoke credential',
      username,
      passwordMode: 'stored',
      passwordCipher: sealSecret(password, dpapiSealer),
      keyFile: null,
      keyPassphraseCipher: null,
      useAgent: false
    }
  ]);

  const smokeHost = createHost({
    id: 'smoke-rdp-iron-host',
    name: process.env.RH_RDP_NAME?.trim() || 'IronRDP smoke host',
    protocol: 'rdp',
    host,
    port,
    username,
    credentialId,
    rdp: {
      domain: process.env.RH_RDP_DOMAIN?.trim() || '',
      screenMode: 'window',
      width: Number(process.env.RH_RDP_WIDTH ?? 1280),
      height: Number(process.env.RH_RDP_HEIGHT ?? 800),
      multiMonitor: false,
      promptForCreds: false
    }
  });
  store.saveProfiles([smokeHost]);
  store.saveSettings({
    ...store.loadSettings().data,
    rdpEngine: 'iron',
    restoreTabs: false,
    openTabs: [],
    onboardingDone: true
  });
  return true;
}

function installMenu(updater: Updater): void {
  const sendMenu = (command: string): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('menu:command', command);
    }
  };
  const menu = Menu.buildFromTemplate([
    {
      label: 'Файл',
      submenu: [
        { label: 'Новая сессия', accelerator: 'Ctrl+Shift+T', click: () => sendMenu('new-session') },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Перезагрузить' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' }
      ]
    },
    {
      label: 'Помощь',
      submenu: [
        { label: 'Справка', accelerator: 'F1', click: () => sendMenu('help') },
        { label: 'Мастер настройки', accelerator: 'F2', click: () => sendMenu('onboarding') },
        { label: 'Горячие клавиши', accelerator: 'F3', click: () => sendMenu('hotkeys') },
        { label: 'Настройки', click: () => sendMenu('settings') },
        { type: 'separator' },
        { label: 'Проверить обновления', click: () => void updater.check(true) },
        {
          label: 'О программе',
          click: () => {
            void dialog
              .showMessageBox({
                type: 'info',
                title: 'Remote Hub',
                message: 'Remote Hub',
                icon: require('fs').existsSync(APP_ICON) ? APP_ICON : DEV_APP_ICON,
                buttons: ['Закрыть', 'Открыть репозиторий'],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
                detail: `Версия ${app.getVersion()}\nРабочий стол для SSH, Telnet, RDP, VNC и SFTP.\n\nРепозиторий: ${APP_REPOSITORY}`
              })
              .then(({ response }) => {
                if (response === 1) void shell.openExternal(APP_REPOSITORY);
              });
          }
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

function normalizeWindowBounds(settings: ReturnType<Store['loadSettings']>['data']): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const saved = settings.winBounds;
  const fallback = { width: 1280, height: 800 };
  const width = Number.isFinite(saved?.width) ? Math.max(MIN_WIDTH, Math.round(saved!.width)) : fallback.width;
  const height = Number.isFinite(saved?.height) ? Math.max(MIN_HEIGHT, Math.round(saved!.height)) : fallback.height;
  const candidate = {
    x: Number.isFinite(saved?.x) ? Math.round(saved!.x) : 0,
    y: Number.isFinite(saved?.y) ? Math.round(saved!.y) : 0,
    width,
    height
  };
  const display = screen.getDisplayMatching(candidate);
  const workArea = display.workArea;
  const x = Math.min(
    Math.max(candidate.x, workArea.x - candidate.width + 80),
    workArea.x + workArea.width - 80
  );
  const y = Math.min(
    Math.max(candidate.y, workArea.y - candidate.height + 80),
    workArea.y + workArea.height - 80
  );
  return { x, y, width: Math.min(candidate.width, workArea.width), height: Math.min(candidate.height, workArea.height) };
}

function createWindow(): void {
  const settings = store.loadSettings().data;
  const bounds = normalizeWindowBounds(settings);
  const icon = require('fs').existsSync(APP_ICON) ? APP_ICON : DEV_APP_ICON;

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: true,
    backgroundColor: settings.theme === 'light' ? '#f4f4f6' : '#17181c',
    title: `Remote Hub v${app.getVersion()}`,
    icon,
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Всё, что renderer пишет в console (включая внутренний лог WASM-клиента
  // IronRDP — он подробно логирует X.224/TLS/CredSSP/NLA через console.*),
  // попадает в журнал приложения: без этого шаги протокола после того, как
  // шлюз отрапортовал "connected", были видны только в devtools, недоступных
  // обычному пользователю при диагностике зависшего подключения.
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (!message) return;
    // Chromium ConsoleMessageLevel: 0=verbose,1=info,2=warning,3=error.
    const mapped = level >= 3 ? 'error' : level === 2 ? 'warn' : 'info';
    const source = /iron|rdp/i.test(message) ? 'iron' : 'app';
    addLog(mapped, source, `[renderer] ${message}`);
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[startup] renderer load failed: ${errorCode} ${errorDescription} (${validatedURL})`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[startup] renderer process gone: ${details.reason}`);
  });

  // Заголовок окна содержит версию; HTML-тег <title> не должен его перезаписывать.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  // Remote Hub не создаёт popup-окна и не позволяет remote-сценам увести
  // рабочее окно на внешний URL. В dev разрешён только origin renderer-сервера,
  // в packaged — локальный file:// документ.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const rendererFileUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
  let rendererOrigin: string | null = null;
  try {
    rendererOrigin = rendererUrl ? new URL(rendererUrl).origin : null;
  } catch {
    rendererOrigin = null;
  }
  const isAllowedRendererUrl = (url: string): boolean => {
    if (url === rendererFileUrl) return true;
    if (!rendererOrigin) return false;
    try {
      return new URL(url).origin === rendererOrigin;
    } catch {
      return false;
    }
  };
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedRendererUrl(url)) event.preventDefault();
  });

  const saveBounds = (): void => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isFullScreen()) {
      return;
    }
    const s = store.loadSettings().data;
    store.saveSettings({ ...s, winBounds: mainWindow.getBounds() });
  };
  mainWindow.on('resize', () => setTimeout(saveBounds, 300));
  mainWindow.on('move', () => setTimeout(saveBounds, 300));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']).catch((error: unknown) => {
      console.error('[startup] renderer URL failed:', error);
    });
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html')).catch((error: unknown) => {
      console.error('[startup] renderer file failed:', error);
    });
  }
}

if (process.env.RH_USER_DATA) {
  app.setPath('userData', process.env.RH_USER_DATA);
}

// При краше прошлой сессии lockfile может остаться и блокировать новый запуск.
// Electron использует именованный мьютекс на Windows (не файл), но на случай
// багов или гонок — разрешаем захват блокировки через удаление lock-файла.
const lockPath = join(app.getPath('userData'), 'lockfile');
let gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  try {
    const stat = require('fs').statSync(lockPath, { throwIfNoEntry: false }) as {
      mtimeMs: number;
    } | undefined;
    if (stat && Date.now() - stat.mtimeMs > 30000) {
      // lockfile старше 30 секунд — stale, удаляем и пробуем снова
      require('fs').unlinkSync(lockPath);
      gotLock = app.requestSingleInstanceLock();
    }
  } catch {
    // файла нет — значит мьютекс занят реальным процессом
  }
}
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'), dpapiSealer);
    if (!seedIronRdpSmoke()) {
      app.exit(2);
      return;
    }
    const broadcast = (channel: string, payload: unknown): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, payload);
      }
    };
    const hostKeyStore = new HostKeyStore(join(app.getPath('userData'), 'hostkeys.json'));
    const sessions = new SessionManager(
      dpapiSealer,
      broadcast as (c: 'session:data' | 'session:state', p: unknown) => void,
      hostKeyStore
    );
    const rdpjs = new RdpjsClientManager({
      onBitmap: (sessionId: string, bitmap: { destLeft: number; destTop: number; width: number; height: number; data: Uint8Array }) => {
        broadcast('rdpjs:bitmap', {
          sessionId,
          destLeft: bitmap.destLeft,
          destTop: bitmap.destTop,
          width: bitmap.width,
          height: bitmap.height,
          // Точная копия кадра: bitmap.data может быть subarray-видом над буфером
          // распаковщика, а structured clone сериализует ВЕСЬ referenced-буфер,
          // не только диапазон вида. Buffer.prototype.slice был deprecated —
          // заменён на явную точную копию (тот же клон, что и раньше).
          data: Buffer.from(bitmap.data)
        });
      },
      onState: (sessionId: string, state: string, error?: string) => {
        broadcast('rdpjs:state', { sessionId, state, error });
        // Атрибуция состояния в хабе: после hub.connect сессия принадлежит
        // rdpjs; disconnected/error снимают владельца (повторный closeTab
        // для мёртвой сессии станет no-op).
        if (state === 'connecting' || state === 'connected' || state === 'disconnected') {
          engineHub.handleEngineEvent('rdpjs', sessionId, { phase: state, message: error });
        }
      }
    });
    const vnc = new VncManager(dpapiSealer, (sessionId, message) => {
      broadcast('vnc:error', { sessionId, message });
    });
    const sftp = new SftpManager(dpapiSealer);
    const tunnels = new TunnelManager(dpapiSealer);
    const updater = new Updater(broadcast);
    const getParentHwnd = (): bigint | null => {
      if (!mainWindow || mainWindow.isDestroyed()) return null;
      try {
        const handle = mainWindow.getNativeWindowHandle();
        if (handle.length >= 8 && typeof handle.readBigUInt64LE === 'function') {
          return handle.readBigUInt64LE(0);
        }
        return BigInt(handle.readUInt32LE(0));
      } catch {
        return null;
      }
    };
    // getContentBounds() всегда в DIP, а rdp-com-host.exe — PER_MONITOR_AWARE_V2
    // (см. rdp-com-host.cs) и ждёт SetWindowPos в физических экранных пикселях.
    // Сам rect вкладки (ipc.ts, IPC.rdpLegacyRect) уже переведён из CSS-px в
    // физические той же формулой (* scaleFactor) до того, как попасть сюда —
    // конвертировать нужно только origin окна, иначе координаты складываются
    // из разных единиц и встроенное окно оказывается смещено/не того размера.
    const getParentOrigin = (): { x: number; y: number } | null => {
      if (!mainWindow || mainWindow.isDestroyed()) return null;
      const bounds = mainWindow.getContentBounds();
      return screen.dipToScreenPoint({ x: bounds.x, y: bounds.y });
    };
    const rdpLegacy = new RdpManager({
      sealer: dpapiSealer,
      send: (channel, payload) => {
        broadcast(channel, payload);
        // Выход процесса rdp-com-host.exe — единственный источник состояний
        // legacy; тот же payload идёт в единый поток состояний хаба.
        if (channel === 'rdp-legacy:exited') {
          engineHub.handleLegacyProcessExit(payload as RdpLegacyExitedPayload);
        }
      },
      getParentHwnd,
      getParentOrigin
    });
    // Единая точка жизненного цикла RDP-движков (риск R6): карта владельцев
    // сессий, capability-маршрутизация ввода/окон, один канал состояний.
    // onConnectResult — атрибуция выбора движка для фазы 2 метрик депрекации
    // rdpjs: каждая попытка запуска (успех или нет) уходит в журнал source 'rdp'
    // с маркером «engine-select:», его агрегирует EngineMetrics (userData,
    // локально, без телеметрии). Секреты в строку не попадают.
    const engineMetrics = new EngineMetrics(join(app.getPath('userData'), 'engine-metrics.json'));
    engineMetrics.attach();
    const engineHub = new RdpEngineHub({
      rdpjs,
      legacy: rdpLegacy,
      onState: (payload) => broadcast('rdp:engine-state', payload),
      onConnectResult: (sessionId, engine, ok) => {
        addLog(
          ok ? 'info' : 'warn',
          'rdp',
          `RDP: выбор движка для сессии ${sessionId} — ${engine}, запуск ${ok ? 'выполнен' : 'не удался'} (engine-select: ${engine}${ok ? '' : ' failed'})`
        );
      }
    });
    installMenu(updater);
    registerIpc(store, sessions, vnc, sftp, tunnels, updater, rdpjs, rdpLegacy, engineHub);
    app.on('before-quit', () => {
      void engineHub.closeAll();
      sessions.closeAll();
      vnc.closeAll();
      sftp.closeAll();
      tunnels.closeAll();
      updater.dispose();
    });
    try {
      createWindow();
    } catch (err) {
      console.error('FATAL: createWindow threw:', (err as Error).stack || (err as Error).message);
      try {
        writeFileSync(
          join(app.getPath('userData'), 'crash.log'),
          `createWindow failed: ${(err as Error).stack || (err as Error).message}`
        );
      } catch {
        // Диалог ниже остаётся последним каналом диагностики, если userData недоступен.
      }
      dialog.showErrorBox('Ошибка запуска', `Не удалось создать окно:\n${(err as Error).message}`);
      app.exit(1);
      return;
    }
    if (mainWindow) installSmokeHooks(mainWindow, store);
    if (mainWindow) {
      // Псевдо-встроенные legacy RDP-окна (owned, не WS_CHILD — см. rdp/embed.ts)
      // не следуют за родителем автоматически: без этого синхронизация позиции/
      // видимости с главным окном сломалась бы при перетаскивании/сворачивании.
      mainWindow.on('move', () => rdpLegacy.refreshLayout());
      mainWindow.on('resize', () => rdpLegacy.refreshLayout());
      mainWindow.on('minimize', () => rdpLegacy.setMinimized(true));
      mainWindow.on('restore', () => rdpLegacy.setMinimized(false));
    }
    updater.start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    console.error('[startup] app initialization failed:', message);
    try {
      writeFileSync(join(app.getPath('userData'), 'crash.log'), `app initialization failed: ${message}`);
    } catch {
      // Не скрываем исходную ошибку, если userData недоступен.
    }
    dialog.showErrorBox('Ошибка запуска Remote Hub', `Приложение не удалось запустить:\n${message}`);
    app.exit(1);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
