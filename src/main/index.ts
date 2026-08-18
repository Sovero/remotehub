import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerIpc } from './ipc';
import { SessionManager } from './sessions/manager';
import { Store } from './store';
import { dpapiSealer } from './store/crypto';

let mainWindow: BrowserWindow | null = null;
let store: Store;

const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

function createWindow(): void {
  const settings = store.loadSettings().data;
  const bounds: { x?: number; y?: number; width: number; height: number } =
    settings.winBounds ?? { width: 1280, height: 800 };

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#17181c',
    title: 'Remote Hub',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (process.env.RH_SMOKE === '1') {
    mainWindow.webContents.on('console-message', (event) => {
      const params = event as unknown as { message?: string; level?: string; stackTrace?: string[] };
      console.log('[renderer]', params.message ?? '');
      if (params.stackTrace?.length) {
        console.log('[renderer-stack]', params.stackTrace.slice(0, 4).join(' | '));
      }
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.error('[smoke] renderer process gone:', details.reason);
      app.exit(1);
    });
    const watchdog = setTimeout(() => {
      console.error('[smoke] timeout: renderer did not become ready');
      app.exit(1);
    }, 20000);
    mainWindow.webContents.once('did-finish-load', () => {
      const check = async (): Promise<void> => {
        const ready = await mainWindow?.webContents.executeJavaScript('window.__RH_READY__ === true');
        if (!ready) {
          console.error('[smoke] renderer loaded but React did not mount');
          app.exit(1);
          return;
        }
        const hostRows = await mainWindow?.webContents.executeJavaScript(
          'document.querySelectorAll(".tree-host").length'
        );
        const expected = Number(process.env.RH_EXPECT_HOSTS ?? 0);
        console.log(
          `[smoke] OK — React mounted, profiles: ${store.loadProfiles().data.length}, host rows in DOM: ${String(hostRows)}`
        );
        if (expected !== (hostRows as number)) {
          console.error(`[smoke] expected ${expected} host rows, got ${String(hostRows)}`);
          app.exit(1);
          return;
        }
        const expectTabs = Number(process.env.RH_EXPECT_TABS ?? -1);
        if (expectTabs >= 0) {
          const tabRows = await mainWindow?.webContents.executeJavaScript(
            'document.querySelectorAll(".tab").length'
          );
          console.log(`[smoke] restored tabs in DOM: ${String(tabRows)}`);
          if (tabRows !== expectTabs) {
            console.error(`[smoke] expected ${expectTabs} restored tabs, got ${String(tabRows)}`);
            app.exit(1);
            return;
          }
          clearTimeout(watchdog);
          app.exit(0);
          return;
        }
        // Сценарий сессии: двойной клик по первому хосту, ждём оверлей ошибки.
        if (process.env.RH_SMOKE_SESSION === '1') {
          await mainWindow?.webContents.executeJavaScript(`
            (async () => {
              const el = document.querySelector('.tree-host');
              if (!el) return 'no-host';
              el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
              const deadline = Date.now() + 15000;
              while (Date.now() < deadline) {
                if (document.querySelector('.session-overlay')) {
                  const tabs = document.querySelectorAll('.tab').length;
                  return 'overlay:' + tabs;
                }
                await new Promise((r) => setTimeout(r, 200));
              }
              return 'no-overlay';
            })()
          `).then((res) => {
            clearTimeout(watchdog);
            if (typeof res === 'string' && res.startsWith('overlay:')) {
              const tabCount = res.split(':')[1];
              console.log(`[smoke] session flow OK — error overlay shown, tabs: ${tabCount}`);
              app.exit(0);
            } else {
              console.error(`[smoke] session flow failed: ${String(res)}`);
              app.exit(1);
            }
          });
          return;
        }
        clearTimeout(watchdog);
        app.exit(0);
      };
      void check();
    });
  }

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
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

if (process.env.RH_USER_DATA) {
  app.setPath('userData', process.env.RH_USER_DATA);
}

const gotLock = app.requestSingleInstanceLock();
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
    const sessions = new SessionManager(dpapiSealer, (channel, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, payload);
      }
    });
    registerIpc(store, sessions);
    app.on('before-quit', () => sessions.closeAll());
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
