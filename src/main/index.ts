import { app, BrowserWindow, dialog, Menu } from 'electron';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { registerIpc } from './ipc';
import { RdpManager } from './rdp/manager';
import { SessionManager } from './sessions/manager';
import { SftpManager } from './sftp/manager';
import { TunnelManager } from './tunnels/manager';
import { VncManager } from './vnc/manager';
import { Store } from './store';
import { dpapiSealer } from './store/crypto';

let mainWindow: BrowserWindow | null = null;
let store: Store;

const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

/** Иконка приложения: в окне и в диалогах (в packaged-сборке — внутри app.asar/build). */
const APP_ICON = join(__dirname, '../../build/icon.ico');

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
              icon: APP_ICON,
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
    backgroundColor: settings.theme === 'light' ? '#f4f4f6' : '#17181c',
    title: 'Remote Hub',
    icon: APP_ICON,
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
      const params = event as unknown as { message?: string; level?: string; stackTrace?: string[]; frame?: unknown };
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
        if (process.env.RH_SMOKE_SCREENSHOT === '1') {
          if (process.env.RH_SHOT_SETTINGS === '1') {
            await mainWindow?.webContents
              .executeJavaScript(`
                (async () => {
                  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                  const btn = document.querySelector('.sidebar-footer [title="Настройки"]');
                  if (!btn) return 'no-settings-btn';
                  btn.click();
                  const deadline = Date.now() + 6000;
                  while (Date.now() < deadline) {
                    const panel = document.querySelector('.sidebar-settings-sheet');
                    if (panel && (panel.textContent || '').includes('Акцентный цвет')) return 'ok';
                    await wait(100);
                  }
                  return 'no-settings-panel';
                })()
              `)
              .then((r) => console.log('[smoke] screenshot: open settings panel →', String(r)));
          }
          if (process.env.RH_SHOT_HOST === '1') {
            await mainWindow?.webContents
              .executeJavaScript(`
                (async () => {
                  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                  const btns = [...document.querySelectorAll('.sidebar-footer .btn--sm')];
                  const addHost = btns.find((b) => (b.textContent || '').includes('Хост'));
                  if (!addHost) return 'no-add-host';
                  addHost.click();
                  const deadline = Date.now() + 6000;
                  while (Date.now() < deadline) {
                    const m = document.querySelector('.modal');
                    if (m && (m.textContent || '').includes('Протокол')) return 'ok';
                    await wait(100);
                  }
                  return 'no-modal';
                })()
              `)
              .then((r) => console.log('[smoke] screenshot: open host dialog →', String(r)));
          }
          if (process.env.RH_SHOT_SESSION === '1') {
            await mainWindow?.webContents
              .executeJavaScript(`
                (async () => {
                  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                  const host = document.querySelector('.tree-host');
                  if (!host) return 'no-host';
                  host.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                  const deadline = Date.now() + 12000;
                  while (Date.now() < deadline) {
                    if (document.querySelector('.session-overlay')) return 'ok';
                    await wait(200);
                  }
                  return 'no-overlay';
                })()
              `)
              .then((r) => console.log('[smoke] screenshot: open session →', String(r)));
          }
          if (process.env.RH_SHOT_AVAIL === '1') {
            await mainWindow?.webContents
              .executeJavaScript(`
                (async () => {
                  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                  const host = document.querySelector('.tree-host');
                  if (!host) return 'no-host';
                  host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 }));
                  await wait(150);
                  const item = [...document.querySelectorAll('.ctxmenu-item')].find((b) =>
                    (b.textContent || '').includes('Проверить доступность')
                  );
                  if (!item) return 'no-item';
                  item.click();
                  const deadline = Date.now() + 8000;
                  while (Date.now() < deadline) {
                    const tip = document.querySelector('.avail-tip');
                    if (
                      tip &&
                      [...tip.querySelectorAll('.avail-tip__row')].some((r) =>
                        r.classList.contains('ok') || r.classList.contains('bad')
                      )
                    ) {
                      return 'ok';
                    }
                    await wait(150);
                  }
                  return 'no-result';
                })()
              `)
              .then((r) => console.log('[smoke] screenshot: availability tip →', String(r)));
          }
          // ждём, пока отрисуются анимации появления и дерево
          await new Promise((r) => setTimeout(r, 1600));
          const image = await mainWindow?.webContents.capturePage();
          const outPath = process.env.RH_SHOT_PATH ?? join(app.getPath('userData'), 'screenshot.png');
          if (!image) {
            console.error('[smoke] screenshot: capturePage вернул null');
            app.exit(1);
            return;
          }
          mkdirSync(dirname(outPath), { recursive: true });
          writeFileSync(outPath, image.toPNG());
          console.log(`[smoke] screenshot saved: ${outPath} (${image.getSize().width}x${image.getSize().height})`);
          app.exit(0);
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
        // Сценарий «Проверить доступность»: контекстное меню хоста → тултип с результатом.
        if (process.env.RH_SMOKE_AVAIL === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const deadline = Date.now() + 15000;
                const host = document.querySelector('.tree-host');
                if (!host) return 'no-host';
                host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 }));
                const menu = await (async () => {
                  while (Date.now() < deadline) {
                    const m = document.querySelector('.ctxmenu');
                    if (m) return m;
                    await wait(100);
                  }
                  return null;
                })();
                if (!menu) return 'no-ctxmenu';
                const item = [...menu.querySelectorAll('.ctxmenu-item')].find((b) =>
                  (b.textContent || '').includes('Проверить доступность')
                );
                if (!item) return 'no-item';
                item.click();
                // ждём завершения проверки: строка результата (не «Проверяю…»)
                while (Date.now() < deadline) {
                  const tip = document.querySelector('.avail-tip');
                  if (tip) {
                    const rows = [...tip.querySelectorAll('.avail-tip__row')];
                    if (rows.some((r) => r.classList.contains('ok') || r.classList.contains('bad'))) {
                      return 'ok:' + (tip.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
                    }
                  }
                  await wait(150);
                }
                return 'no-result';
              })()
            `)
            .then((res) => {
              clearTimeout(watchdog);
              if (typeof res === 'string' && res.startsWith('ok:')) {
                console.log(`[smoke] availability flow OK — ${String(res).slice(3)}`);
                app.exit(0);
              } else {
                console.error(`[smoke] availability flow failed: ${String(res)}`);
                app.exit(1);
              }
            });
          return;
        }
        // Сценарий темы/акцента: настройки из сайдбара → светлая тема → акцент.
        if (process.env.RH_SMOKE_THEME === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const deadline = Date.now() + 10000;
                const until = async (pred) => {
                  while (Date.now() < deadline) {
                    const v = pred();
                    if (v) return v;
                    await wait(100);
                  }
                  return null;
                };
                // 1. Настройки — кнопка в подвале левой панели.
                const btn = document.querySelector('.sidebar-footer [title="Настройки"]');
                if (!btn) return 'no-settings-btn';
                btn.click();
                const panel = await until(() => {
                  const p = document.querySelector('.sidebar-settings-sheet');
                  return p && (p.textContent || '').includes('Акцентный цвет') ? p : null;
                });
                if (!panel) return 'no-settings-panel';
                if (!document.querySelector('.sidebar .sidebar-settings-sheet')) return 'panel-not-in-sidebar';
                // 2. Светлая тема.
                const lightBtn = [...panel.querySelectorAll('.seg-btn')].find((b) => b.textContent === 'Светлая');
                if (!lightBtn) return 'no-light-btn';
                lightBtn.click();
                await wait(150);
                if (document.documentElement.dataset.theme !== 'light') return 'theme-not-light';
                const bodyBg = getComputedStyle(document.body).backgroundColor;
                // 3. Акцентный цвет (зелёный из палитры).
                const swatch = [...panel.querySelectorAll('.accent-swatch')].find((s) => s.style.background === 'rgb(87, 171, 90)');
                if (!swatch) return 'no-swatch';
                swatch.click();
                await wait(150);
                const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
                const css = (sel) => {
                  const el = document.querySelector(sel);
                  return el ? getComputedStyle(el).backgroundColor : 'none';
                };
                const probe = JSON.stringify({
                  theme: document.documentElement.dataset.theme,
                  accent,
                  body: css('body'),
                  app: css('.app'),
                  sidebar: css('.sidebar'),
                  settingsPanel: css('.sidebar-body--settings'),
                  tabbar: css('.tabbar'),
                  main: css('main'),
                  modal: css('.modal')
                });
                const ok = accent.toLowerCase() === '#57ab5a' && bodyBg !== 'rgb(23, 24, 28)';
                // 4. Возврат к дереву: крестик в шапке панели (или повторный клик по ⚙).
                const closeBtn = [...panel.querySelectorAll('.sidebar-settings-sheet__head button')].find((b) => (b.textContent || '').includes('✕'));
                if (!closeBtn) return 'no-close-btn';
                closeBtn.click();
                await wait(150);
                if (!document.querySelector('.sidebar-settings-sheet') && document.querySelector('.tree-host, .sidebar-empty')) {
                  return 'ok' + ' probe:' + probe;
                }
                return 'back-failed' + ' probe:' + probe;
              })()
            `)
            .then(async (res) => {
              clearTimeout(watchdog);
              if (typeof res === 'string' && res.startsWith('ok')) {
                console.log('[smoke] theme flow OK — светлая тема и акцент применяются');
                const shotPath = process.env.RH_SHOT_PATH;
                if (shotPath) {
                  await new Promise((r) => setTimeout(r, 400));
                  const image = await mainWindow?.webContents.capturePage();
                  if (image) {
                    mkdirSync(dirname(shotPath), { recursive: true });
                    writeFileSync(shotPath, image.toPNG());
                    console.log(`[smoke] theme screenshot saved: ${shotPath}`);
                  }
                }
                app.exit(0);
              } else {
                console.error(`[smoke] theme flow failed: ${String(res)}`);
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
        // Сценарий SFTP/туннелей: SSH-вкладка → диалог туннелей → SFTP-панель
        // через контекстное меню (порт мёртвый, проверяем путь до ошибки UI).
        if (process.env.RH_SMOKE_SFTP_TUNNELS === '1') {
          await mainWindow?.webContents.executeJavaScript(`
            (async () => {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              const deadline = Date.now() + 12000;
              const until = async (pred) => {
                while (Date.now() < deadline) {
                  const v = pred();
                  if (v) return v;
                  await wait(100);
                }
                return null;
              };
              // 1. SSH-хост → терминальная вкладка (подключение упадёт на мёртвом порту).
              const host = document.querySelector('.tree-host');
              if (!host) return 'no-host';
              host.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
              const tab = await until(() => (document.querySelectorAll('.tab').length >= 1 ? true : null));
              if (!tab) return 'no-tab';
              // 2. Кнопка туннелей в таббаре → модал открывается.
              const tunBtn = document.querySelector('[title="Туннели (порт-форвардинг)"]');
              if (!tunBtn) return 'no-tunnels-btn';
              tunBtn.click();
              const modal = await until(() => {
                const m = document.querySelector('.modal');
                return m && (m.textContent || '').includes('Туннели') ? m : null;
              });
              if (!modal) return 'no-tunnels-modal';
              const closeBtn = document.querySelector('.modal-close');
              if (closeBtn) closeBtn.click();
              await wait(200);
              if (document.querySelector('.modal')) return 'modal-still-open';
              // 3. SFTP через контекстное меню хоста → панель с ошибкой (порт мёртвый).
              const host2 = document.querySelector('.tree-host');
              if (!host2) return 'no-host-2';
              host2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
              const sftpItem = await until(() => {
                const item = [...document.querySelectorAll('.ctxmenu-item')].find((b) => b.textContent === 'SFTP');
                return item || null;
              });
              if (!sftpItem) return 'no-sftp-menu-item';
              sftpItem.click();
              const pane = await until(() => {
                const p = document.querySelector('.sftp-pane');
                return p || null;
              });
              if (!pane) return 'no-sftp-pane';
              const text = pane.textContent || '';
              return text.includes('Не удалось открыть SFTP')
                ? 'ok:' + document.querySelectorAll('.tab').length
                : 'pane:' + text.slice(0, 120);
            })()
          `).then((res) => {
            clearTimeout(watchdog);
            if (typeof res === 'string' && res.startsWith('ok:')) {
              console.log(`[smoke] sftp/tunnels flow OK — диалог туннелей и SFTP-панель открылись, tabs: ${res.split(':')[1]}`);
              app.exit(0);
            } else {
              console.error(`[smoke] sftp/tunnels flow failed: ${String(res)}`);
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
    const sftp = new SftpManager(dpapiSealer);
    const tunnels = new TunnelManager(dpapiSealer);
    registerIpc(store, sessions, rdp, vnc, sftp, tunnels);
    app.on('before-quit', () => {
      sessions.closeAll();
      rdp.closeAll();
      vnc.closeAll();
      sftp.closeAll();
      tunnels.closeAll();
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
