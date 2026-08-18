import { app, BrowserWindow, dialog, Menu } from 'electron';
import { join } from 'path';
import { registerIpc } from './ipc';
import { RdpManager } from './rdp/manager';
import { SessionManager } from './sessions/manager';
import { VncManager } from './vnc/manager';
import { Store } from './store';
import { dpapiSealer } from './store/crypto';

let mainWindow: BrowserWindow | null = null;
let store: Store;

const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

function installMenu(): void {
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
        { label: 'Горячие клавиши', accelerator: 'F1', click: () => sendMenu('hotkeys') },
        { label: 'Настройки', click: () => sendMenu('settings') },
        { type: 'separator' },
        {
          label: 'О программе',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'Remote Hub',
              message: 'Remote Hub',
              detail: `Версия ${app.getVersion()}\nElectron ${process.versions.electron ?? ''}\nРабочий стол для SSH, Telnet, RDP, VNC и SFTP.`
            });
          }
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

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
      const waitReady = async (): Promise<boolean> => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const ready = await mainWindow?.webContents.executeJavaScript('window.__RH_READY__ === true');
          if (ready) return true;
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      };
      const check = async (): Promise<void> => {
        const ready = await waitReady();
        if (!ready) {
          const err = await mainWindow?.webContents.executeJavaScript(`
            JSON.stringify({ rhError: window.__RH_ERROR__ || null, href: location.href })
          `);
          console.error(`[smoke] renderer loaded but React did not mount; error: ${String(err)}`);
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
        if (process.env.RH_SMOKE_VNC === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const el = document.querySelector('.tree-host');
                if (!el) return 'no-host';
                el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                const deadline = Date.now() + 8000;
                while (Date.now() < deadline) {
                  if (document.querySelector('.vnc-wrap')) return 'ok';
                  if (document.querySelector('.session-overlay')) {
                    const msg = document.querySelector('.session-overlay-message')?.textContent || '';
                    return 'overlay:' + msg;
                  }
                  await new Promise((r) => setTimeout(r, 200));
                }
                return 'no-pane';
              })()
            `)
            .then((res) => {
              clearTimeout(watchdog);
              if (res === 'ok') {
                console.log('[smoke] vnc flow OK — мост поднят, вьювер смонтирован');
                app.exit(0);
              } else {
                console.error(`[smoke] vnc flow failed: ${String(res)}`);
                app.exit(1);
              }
            });
          return;
        }
        if (process.env.RH_SMOKE_RDP === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const el = document.querySelector('.tree-host');
                if (!el) return 'no-host';
                el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                const deadline = Date.now() + 8000;
                let sawPane = false;
                while (Date.now() < deadline) {
                  if (document.querySelector('.rdp-pane')) sawPane = true;
                  if (sawPane && document.querySelector('.session-overlay')) return 'ok';
                  await new Promise((r) => setTimeout(r, 200));
                }
                return sawPane ? 'no-closed-state' : 'no-pane';
              })()
            `)
            .then((res) => {
              clearTimeout(watchdog);
              if (res === 'ok') {
                console.log('[smoke] rdp flow OK — вкладка прошла connected → closed');
                app.exit(0);
              } else {
                console.error(`[smoke] rdp flow failed: ${String(res)}`);
                app.exit(1);
              }
            });
          return;
        }
        if (process.env.RH_SMOKE_CRED === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const btn = document.querySelector('[title="Наборы учётных данных"]');
                if (!btn) return 'no-btn';
                btn.click();
                const deadline = Date.now() + 5000;
                while (Date.now() < deadline) {
                  const item = document.querySelector('.cred-item');
                  if (item) {
                    const text = item.textContent || '';
                    if (text.includes('ПРОДСЕТ') && !text.includes('secret-password-123')) return 'ok';
                    return 'bad:' + text;
                  }
                  await new Promise((r) => setTimeout(r, 100));
                }
                return 'no-item';
              })()
            `)
            .then((res) => {
              clearTimeout(watchdog);
              if (res === 'ok') {
                console.log('[smoke] credentials flow OK — набор виден, пароль не утёк в DOM');
                app.exit(0);
              } else {
                console.error(`[smoke] credentials flow failed: ${String(res)}`);
                app.exit(1);
              }
            });
          return;
        }
        if (process.env.RH_SMOKE_SNIPS === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const btns = document.querySelectorAll('.tabbar-new');
                const snipBtn = [...btns].find((b) => b.textContent === 'Σ');
                if (!snipBtn) return 'no-btn';
                snipBtn.click();
                const deadline = Date.now() + 5000;
                while (Date.now() < deadline) {
                  const item = document.querySelector('.snips-item');
                  if (item) {
                    const text = item.textContent || '';
                    return text.includes('Обновить систему') && text.includes('apt update') ? 'ok' : 'bad:' + text;
                  }
                  await new Promise((r) => setTimeout(r, 100));
                }
                return 'no-item';
              })()
            `)
            .then((res) => {
              clearTimeout(watchdog);
              if (res === 'ok') {
                console.log('[smoke] snippets flow OK — поповер со сниппетом открывается');
                app.exit(0);
              } else {
                console.error(`[smoke] snippets flow failed: ${String(res)}`);
                app.exit(1);
              }
            });
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
    installMenu();
    store = new Store(app.getPath('userData'), dpapiSealer);
    const broadcast = (channel: string, payload: unknown): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, payload);
      }
    };
    const sessions = new SessionManager(dpapiSealer, broadcast as (c: 'session:data' | 'session:state', p: unknown) => void);
    const rdp = new RdpManager(dpapiSealer, broadcast as (c: 'rdp:exited', p: unknown) => void);
    const vnc = new VncManager(dpapiSealer);
    registerIpc(store, sessions, rdp, vnc);
    app.on('before-quit', () => {
      sessions.closeAll();
      rdp.closeAll();
      vnc.closeAll();
    });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
