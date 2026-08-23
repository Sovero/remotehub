import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { registerIpc } from './ipc';
import { RdpManager } from './rdp/manager';
import { SessionManager } from './sessions/manager';
import { SftpManager } from './sftp/manager';
import { TunnelManager } from './tunnels/manager';
import { VncManager } from './vnc/manager';
import { Store } from './store';
import { createHost } from '../shared/types';
import { dpapiSealer } from './store/crypto';
import { Updater } from './updater';

let mainWindow: BrowserWindow | null = null;
let store: Store;

const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

/** Иконка приложения: в окне и в диалогах (в packaged-сборке — внутри app.asar/build). */
const APP_ICON = join(__dirname, '../../build/icon.ico');

const APP_REPOSITORY = 'https://github.com/Sovero/remotehub';

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
                icon: APP_ICON,
                buttons: ['Закрыть', 'Открыть репозиторий'],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
                detail: `Версия ${app.getVersion()}\nElectron ${process.versions.electron ?? ''}\nРабочий стол для SSH, Telnet, RDP, VNC и SFTP.\n\nРепозиторий: ${APP_REPOSITORY}`
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

function createWindow(rdp: RdpManager): void {
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
    title: `Remote Hub v${app.getVersion()}`,
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

  // Заголовок окна содержит версию; HTML-тег <title> не должен его перезаписывать.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  // RH_SMOKE_RDP_EMBED: реальный mstsc против живого/мёртвого порта (RH_RDP_PORT).
  // Проверяем: окно найдено и встроено, а предупреждение безопасности сертификата
  // автоматически подтверждено (mstsc не запоминает сертификат в новых Windows).
  if (process.env.RH_SMOKE_RDP_EMBED === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[smoke] rdp embed: запуск');
      // Счётчик видимых предупреждений безопасности у живых mstsc-процессов.
      // koffi-привязки создаются один раз, вне циклов опроса.
      let countWarnings: () => number = () => -1;
      try {
        const { execFileSync } = require('child_process') as typeof import('child_process');
        const koffi = require('koffi') as typeof import('koffi');
        const user32 = koffi.load('user32.dll');
        const SBOOL = koffi.alias('SMOKE_BOOL', 'int32_t');
        const SDWORD = koffi.alias('SMOKE_DWORD', 'uint32_t');
        const SHANDLE = koffi.pointer('SMOKE_HANDLE', koffi.opaque());
        const SHWND = koffi.alias('SMOKE_HWND', SHANDLE);
        const SLPARAM = koffi.alias('SMOKE_LPARAM', koffi.types.intptr);
        const sproto = koffi.proto('SMOKE_BOOL __stdcall SP(SMOKE_HWND hwnd, SMOKE_LPARAM lParam)');
        const SEnumWindows = user32.func('SMOKE_BOOL __stdcall EnumWindows(SP *cb, SMOKE_LPARAM lParam)');
        const SGetWindowThreadProcessId = user32.func('SMOKE_DWORD __stdcall GetWindowThreadProcessId(SMOKE_HWND hwnd, _Out_ SMOKE_DWORD *pid)');
        const SGetWindowTextW = user32.func('int __stdcall GetWindowTextW(SMOKE_HWND hwnd, _Out_ char16_t *buf, int max)');
        const SIsWindowVisible = user32.func('SMOKE_BOOL __stdcall IsWindowVisible(SMOKE_HWND hwnd)');
        countWarnings = (): number => {
          const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq mstsc.exe', '/FO', 'CSV', '/NH'], {
            encoding: 'utf8'
          });
          const pids = [...out.matchAll(/"mstsc.exe","(\d+)"/g)].map((m) => Number(m[1]));
          let count = 0;
          SEnumWindows((hwnd: unknown) => {
            if (hwnd === null) return 1;
            const ref: (number | null)[] = [null];
            SGetWindowThreadProcessId(hwnd, ref);
            if (!pids.includes(ref[0] ?? -1) || SIsWindowVisible(hwnd) === 0) return 1;
            const buf = Buffer.allocUnsafe(2048);
            const n = SGetWindowTextW(hwnd, buf, 1024);
            const t = n > 0 ? buf.subarray(0, n * 2).toString('utf16le') : '';
            if (t.includes('Предупреждение системы безопасности')) count++;
            return 1;
          }, 0);
          return count;
        };
      } catch (err) {
        console.error('[smoke] rdp embed: не удалось инициализировать проверку предупреждений:', (err as Error).message);
      }

      const host = createHost({
        id: 'smoke-rdp',
        name: 'Smoke RDP',
        protocol: 'rdp',
        host: '127.0.0.1',
        port: Number(process.env.RH_RDP_PORT ?? 3389),
        username: 'smoke',
        rdp: {
          domain: '',
          screenMode: 'window',
          width: 800,
          height: 600,
          multiMonitor: false,
          promptForCreds: false
        }
      });
      const sessionId = 'smoke-rdp-embed';
      const outcome = rdp.launch(host, null, sessionId);
      Promise.resolve(outcome).then(() => {
        const autoAccept = process.env.RH_RDP_AUTO_ACCEPT !== '0';
        const deadline = Date.now() + 20000;
        const poll = (): void => {
          if (rdp.isEmbedded(sessionId)) {
            if (!autoAccept) {
              // Настройка «показывать предупреждение»: диалог должен остаться
              // видимым для пользователя — авто-подтверждения быть не должно.
              const warnDeadline = Date.now() + 8000;
              const waitWarningShown = (): void => {
                const warningsLeft = countWarnings();
                if (warningsLeft > 0) {
                  console.log(`[smoke] rdp embed OK — окно встроено, предупреждение показано пользователю (видимых: ${String(warningsLeft)})`);
                  rdp.stop(sessionId);
                  setTimeout(() => app.exit(0), 1200);
                  return;
                }
                if (Date.now() > warnDeadline) {
                  console.error('[smoke] rdp embed FAIL — предупреждение не показано за 8 секунд');
                  rdp.closeAll();
                  app.exit(1);
                  return;
                }
                setTimeout(waitWarningShown, 300);
              };
              waitWarningShown();
              return;
            }
            // Предупреждение появляется чуть позже встраивания (mstsc сначала
            // показывает окно, затем — диалог о сертификате); сторож гасит его
            // кликом «Подключить» на своих тиках. Даём ему до 8 секунд.
            const warnDeadline = Date.now() + 8000;
            const waitWarningsGone = (): void => {
              const warningsLeft = countWarnings();
              if (warningsLeft === 0) {
                console.log('[smoke] rdp embed OK — окно встроено, предупреждение безопасности погашено');
                rdp.stop(sessionId);
                setTimeout(() => app.exit(0), 1200);
                return;
              }
              if (Date.now() > warnDeadline) {
                console.error(`[smoke] rdp embed FAIL — предупреждение не погашено за 8 секунд (осталось: ${String(warningsLeft)})`);
                rdp.closeAll();
                app.exit(1);
                return;
              }
              setTimeout(waitWarningsGone, 300);
            };
            waitWarningsGone();
            return;
          }
          if (Date.now() > deadline) {
            console.error('[smoke] rdp embed FAIL — окно не встроено за 20 секунд');
            rdp.closeAll();
            app.exit(1);
            return;
          }
          setTimeout(poll, 300);
        };
        poll();
      });
    });
  }

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
        // Дерево отрисовывается после IPC-инициализации — ждём появления хостов (до 8 с).
        const expected = Number(process.env.RH_EXPECT_HOSTS ?? 0);
        let hostRows = 0;
        const hostDeadline = Date.now() + 8000;
        while (Date.now() < hostDeadline) {
          hostRows = (await mainWindow?.webContents.executeJavaScript(
            'document.querySelectorAll(".tree-host").length'
          )) as number;
          if (hostRows === expected) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        console.log(
          `[smoke] OK — React mounted, profiles: ${store.loadProfiles().data.length}, host rows in DOM: ${String(hostRows)}`
        );

        // Заголовок окна содержит версию: «Remote Hub vX.Y.Z» (не перезаписан HTML-тегом).
        const winTitle = mainWindow?.getTitle() ?? '';
        if (!/^Remote Hub v\d+\.\d+\.\d+$/.test(winTitle)) {
          console.error(`[smoke] window title без версии: ${JSON.stringify(winTitle)}`);
          app.exit(1);
          return;
        }

        // Скриншот заданной темы/акцента (RH_SHOT_DIR, RH_SHOT_THEME, RH_SHOT_ACCENT).
        if (process.env.RH_SHOT_DIR) {
          clearTimeout(watchdog);
          const shotTheme = process.env.RH_SHOT_THEME ?? 'dark';
          const shotAccent = process.env.RH_SHOT_ACCENT ?? '#2d95ec';
          await mainWindow?.webContents
            .executeJavaScript(
              `(async () => {
                const store = window.__RH_STORE__;
                if (!store) return 'no-store-hook';
                store.getState().patchSettings({ theme: '${shotTheme}', accent: '${shotAccent}' });
                await new Promise((r) => setTimeout(r, 400));
                return 'ok:1';
              })()`
            )
            .then(async (res) => {
              if (typeof res !== 'string' || !res.startsWith('ok:')) {
                console.error(`[shot] apply theme/accent failed: ${String(res)}`);
                app.exit(1);
                return;
              }
              await new Promise((r) => setTimeout(r, 300));
              const image = await mainWindow?.webContents.capturePage();
              if (!image) {
                console.error('[shot] capturePage вернул null');
                app.exit(1);
                return;
              }
              mkdirSync(process.env.RH_SHOT_DIR!, { recursive: true });
              const name = `${shotTheme}-${shotAccent.replace('#', '')}.png`;
              writeFileSync(join(process.env.RH_SHOT_DIR!, name), image.toPNG());
              console.log(`[shot] ${name} (${image.getSize().width}x${image.getSize().height})`);
              app.exit(0);
            });
          return;
        }
        // Генерация реальных скриншотов для встроенной справки (npm run help:shots).
        if (process.env.RH_CAPTURE_HELP === '1') {
          clearTimeout(watchdog);
          const captureDir = process.env.RH_CAPTURE_DIR ?? join(process.cwd(), 'src/renderer/src/assets/help');
          const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
          const drive = (js: string): Promise<unknown> =>
            mainWindow?.webContents.executeJavaScript(js) ?? Promise.resolve(null);
          const shot = async (name: string): Promise<void> => {
            await sleep(700);
            const image = await mainWindow?.webContents.capturePage();
            if (!image) {
              console.error(`[capture] ${name}: capturePage вернул null`);
              return;
            }
            mkdirSync(captureDir, { recursive: true });
            writeFileSync(join(captureDir, `${name}.png`), image.toPNG());
            console.log(`[capture] ${name}.png (${image.getSize().width}x${image.getSize().height})`);
          };
          const closeModal = "(() => { const c = document.querySelector('.modal-close'); if (c) c.click(); return 'ok'; })()";
          const waitProbe = "const wait = (ms) => new Promise((r) => setTimeout(r, ms));";
          const steps: { name: string; js: string; close?: string }[] = [
            {
              name: 'overview',
              js: `(async () => { ${waitProbe} const deadline = Date.now() + 6000; while (Date.now() < deadline) { const t = document.querySelector('.tour-overlay'); if (!t) return 'ok'; const skip = t.querySelector('.btn--ghost'); if (skip) skip.click(); await wait(100); } return document.querySelector('.tour-overlay') ? 'tour-open' : 'ok'; })()`
            },            {
              name: 'settings',
              js: `(async () => { ${waitProbe} const btn = document.querySelector('.sidebar-footer [title="Настройки"]'); if (!btn) return 'no-btn'; btn.click(); const deadline = Date.now() + 6000; while (Date.now() < deadline) { if (document.querySelector('.sidebar-settings-sheet')) return 'ok'; await wait(100); } return 'no-panel'; })()`,
              close: `(() => { const btn = document.querySelector('.sidebar-footer [title="Настройки"]'); if (btn) btn.click(); return 'ok'; })()`
            },
            {
              name: 'host-dialog',
              js: `(async () => { ${waitProbe} const btn = [...document.querySelectorAll('.sidebar-footer .btn--sm')].find((b) => (b.textContent || '').includes('Хост')); if (!btn) return 'no-btn'; btn.click(); const deadline = Date.now() + 6000; while (Date.now() < deadline) { const m = document.querySelector('.modal'); if (m && (m.textContent || '').includes('Протокол')) return 'ok'; await wait(100); } return 'no-modal'; })()`,
              close: closeModal
            },
            {
              name: 'credentials',
              js: `(async () => { ${waitProbe} const btn = document.querySelector('[title="Наборы учётных данных"]'); if (!btn) return 'no-btn'; btn.click(); const deadline = Date.now() + 6000; while (Date.now() < deadline) { const m = document.querySelector('.modal'); if (m && (m.textContent || '').includes('Учётные данные')) return 'ok'; await wait(100); } return 'no-modal'; })()`,
              close: closeModal
            },
            {
              name: 'availability',
              js: `(async () => { ${waitProbe} const host = document.querySelector('.tree-host'); if (!host) return 'no-host'; host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 150 })); let item = null; const d1 = Date.now() + 6000; while (Date.now() < d1) { item = [...document.querySelectorAll('.ctxmenu-item')].find((b) => (b.textContent || '').includes('Проверить доступность')); if (item) break; await wait(100); } if (!item) return 'no-item'; item.click(); const d2 = Date.now() + 8000; while (Date.now() < d2) { if (document.querySelector('.avail-tip')) return 'ok'; await wait(100); } return 'no-tip'; })()`,
              close: `(() => { const c = document.querySelector('.avail-tip__close'); if (c) c.click(); return 'ok'; })()`
            },
            {
              name: 'tree',
              js: `(async () => { ${waitProbe} const host = document.querySelector('.tree-host'); if (!host) return 'no-host'; host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 150 })); const deadline = Date.now() + 6000; while (Date.now() < deadline) { if (document.querySelector('.ctxmenu')) return 'ok'; await wait(100); } return 'no-ctxmenu'; })()`,
              close: `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 'ok'; })()`
            },
            {
              name: 'snips',
              js: `(async () => { ${waitProbe} const btn = document.querySelector('[title="Сниппеты"]'); if (!btn) return 'no-btn'; btn.click(); const deadline = Date.now() + 6000; while (Date.now() < deadline) { if (document.querySelector('.snips-pop')) return 'ok'; await wait(100); } return 'no-pop'; })()`,
              close: `(() => { const b = document.querySelector('[title="Сниппеты"]'); if (b) b.click(); return 'ok'; })()`
            },
            {
              name: 'new-session',
              js: `(async () => { ${waitProbe} const btn = document.querySelector('.tabbar-new'); if (!btn) return 'no-btn'; btn.click(); const deadline = Date.now() + 6000; while (Date.now() < deadline) { const m = document.querySelector('.modal'); if (m && (m.textContent || '').includes('Новая сессия')) return 'ok'; await wait(100); } return 'no-modal'; })()`,
              close: closeModal
            },
            {
              name: 'session-error',
              js: `(async () => { ${waitProbe} const input = document.querySelector('.quick-connect-input'); if (!input) return 'no-input'; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'root@127.0.0.1:1'); input.dispatchEvent(new Event('input', { bubbles: true })); await wait(200); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); const deadline = Date.now() + 15000; while (Date.now() < deadline) { if (document.querySelector('.session-overlay')) return 'ok'; await wait(200); } return 'no-overlay'; })()`,
              close: `(() => { const b = [...document.querySelectorAll('.session-overlay .btn')].find((x) => (x.textContent || '').includes('Закрыть вкладку')); if (b) b.click(); return 'ok'; })()`
            }
          ];
          for (const s of steps) {
            const res = await drive(s.js);
            console.log(`[capture] step ${s.name} → ${String(res)}`);
            await shot(s.name);
            if (s.close) {
              await drive(s.close);
              await sleep(400);
            }
          }
          console.log(`[capture] готово: ${captureDir}`);
          app.exit(0);
          return;
        }

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
          if (process.env.RH_SHOT_HELP === '1') {
            mainWindow?.webContents.send('menu:command', 'help');
            const wantSection = process.env.RH_SHOT_HELP_SECTION ?? '';
            await mainWindow?.webContents
              .executeJavaScript(`
                (async () => {
                  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                  const deadline = Date.now() + 6000;
                  const want = ${JSON.stringify(wantSection)};
                  while (Date.now() < deadline) {
                    const h = document.querySelector('.help');
                    if (h && (h.textContent || '').includes('Справка Remote Hub')) {
                      if (want) {
                        const item = [...document.querySelectorAll('.help-nav-item')].find((b) =>
                          (b.textContent || '').includes(want)
                        );
                        if (item) { item.click(); await wait(300); }
                        const title = document.querySelector('.help-section-title')?.textContent || '';
                        return 'ok:sections=' + document.querySelectorAll('.help-nav-item').length + ':title=' + title;
                      }
                      return 'ok:sections=' + document.querySelectorAll('.help-nav-item').length;
                    }
                    await wait(100);
                  }
                  return 'no-help';
                })()
              `)
              .then((r) => console.log('[smoke] screenshot: open help →', String(r)));
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
                  if (document.querySelector('.vnc-wrap')) break;
                  if (document.querySelector('.session-overlay')) {
                    const msg = document.querySelector('.session-overlay-message')?.textContent || '';
                    return 'overlay:' + msg;
                  }
                  await new Promise((r) => setTimeout(r, 200));
                }
                if (!document.querySelector('.vnc-wrap')) return 'no-pane';
                // Ждём отрисовки реального кадра: canvas noVNC с ненулевыми пикселями.
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const pixelDeadline = Date.now() + 8000;
                let colored = 0;
                while (Date.now() < pixelDeadline) {
                  const canvas = document.querySelector('.vnc-canvas canvas');
                  if (canvas) {
                    try {
                      const ctx = canvas.getContext('2d');
                      if (ctx) {
                        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        let nonBlack = 0;
                        for (let i = 0; i < img.data.length; i += 40) {
                          if (img.data[i] > 10 || img.data[i + 1] > 10 || img.data[i + 2] > 10) nonBlack++;
                        }
                        colored = nonBlack;
                        if (nonBlack > 0) {
                          // Кадр есть — но вкладка не должна при этом лежать в оверлее ошибки
                          // (регрессия: rfb.connect() раньше ронял состояние в error).
                          if (document.querySelector('.session-overlay')) {
                            return 'overlay-despite-canvas:' + (document.querySelector('.session-overlay-message')?.textContent || '');
                          }
                          // Статусбар: живая подсказка — локальный порт VNC-моста.
                          const hint = document.querySelector('.statusbar-live-hint');
                          const hintText = hint ? (hint.textContent || '').trim() : '';
                          if (!hint || !/^порт \\\d+$/.test(hintText)) return 'no-vnc-hint:' + hintText;
                          if (!hint.querySelector('svg')) return 'no-hint-icon';
                          return 'ok:canvas=' + canvas.width + 'x' + canvas.height + ':colored=' + nonBlack + ':hint=' + hintText;
                        }
                      }
                    } catch {
                      // canvas ещё не готов
                    }
                  }
                  await wait(200);
                }
                return 'blank-canvas:' + colored;
              })()
            `)
            .then((res) => {
              clearTimeout(watchdog);
              if (typeof res === 'string' && res.startsWith('ok:')) {
                console.log(`[smoke] vnc flow OK — мост поднят, кадр отрисован (${String(res).slice(3)})`);
                app.exit(0);
              } else {
                console.error(`[smoke] vnc flow failed: ${String(res)}`);
                app.exit(1);
              }
            });
          return;
        }
        // Ошибка рукопожатия VNC: сервер молчит → вкладка показывает понятный оверлей.
        if (process.env.RH_SMOKE_VNC_ERROR === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const el = document.querySelector('.tree-host');
                if (!el) return 'no-host';
                el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                const deadline = Date.now() + 20000;
                while (Date.now() < deadline) {
                  const overlay = document.querySelector('.session-overlay-message');
                  if (overlay) {
                    const msg = overlay.textContent || '';
                    if (msg.includes('не отвечает на рукопожатие')) return 'ok:' + msg;
                    return 'other:' + msg;
                  }
                  await new Promise((r) => setTimeout(r, 200));
                }
                return 'no-overlay';
              })()
            `)
            .then((res) => {
              clearTimeout(watchdog);
              if (typeof res === 'string' && res.startsWith('ok:')) {
                console.log(`[smoke] vnc error flow OK — ${String(res).slice(3)}`);
                app.exit(0);
              } else {
                console.error(`[smoke] vnc error flow failed: ${String(res)}`);
                app.exit(1);
              }
            });
          return;
        }
        // Иконки в кнопках: после добавления Icon-компонента кнопки не должны
        // терять содержимое, а svg — рендериться с ненулевым размером.
        if (process.env.RH_SMOKE_ICONS === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const svgInfo = (svg) => ({
                  w: svg.getBoundingClientRect().width,
                  h: svg.getBoundingClientRect().height,
                  vis: getComputedStyle(svg).visibility !== 'hidden'
                });
                const check = (selector) => {
                  const els = [...document.querySelectorAll(selector)];
                  return els.map((el) => {
                    const svg = el.querySelector('svg');
                    return svg ? svgInfo(svg) : null;
                  });
                };
                const footer = check('.sidebar-footer .btn');
                if (footer.some((s) => !s || s.w < 8 || s.h < 8)) return 'bad-footer:' + JSON.stringify(footer);
                const tabbarNew = check('.tabbar-new');
                if (tabbarNew.some((s) => !s || s.w < 8)) return 'bad-tabbar:' + JSON.stringify(tabbarNew);
                // Строка статуса: индикатор «хосты / сессии» с иконками дерева и вкладок.
                const counters = document.querySelector('.statusbar-counters');
                if (!counters) return 'no-counters';
                const cSvgs = counters.querySelectorAll('svg');
                if (cSvgs.length !== 2) return 'bad-counters-svg:' + cSvgs.length;
                if ([...cSvgs].some((s) => s.getBoundingClientRect().width < 8)) return 'bad-counters-size';
                if (!counters.querySelector('.statusbar-divider')) return 'no-counter-divider';
                const cCounts = [...counters.querySelectorAll('.statusbar-count')].map((el) => Number(el.textContent));
                if (cCounts.length !== 2 || cCounts[0] !== 3 || cCounts[1] !== 0)
                  return 'bad-counts:' + JSON.stringify(cCounts);
                // Статусбар: живая подсказка RDP — адрес сервера из сида (хост h2 → 127.0.0.1).
                const store = window.__RH_STORE__;
                if (!store) return 'no-store-hook';
                store.setState({
                  tabs: [
                    {
                      sessionId: 'rdp-hint',
                      hostId: 'h2',
                      title: 'RDP Win',
                      protocol: 'rdp',
                      kind: 'rdp',
                      state: { phase: 'connecting' },
                      adHocHost: null,
                      startedAt: null
                    }
                  ],
                  activeTabId: 'rdp-hint'
                });
                await wait(250);
                const rdpHint = document.querySelector('.statusbar-live-hint');
                const rdpText = rdpHint ? (rdpHint.textContent || '').trim() : '';
                if (rdpText !== '127.0.0.1') return 'bad-rdp-hint:' + rdpText;
                if (!rdpHint || !rdpHint.querySelector('svg')) return 'no-rdp-hint-icon';
                store.setState({ tabs: [], activeTabId: null });
                await wait(150);
                if (document.querySelector('.statusbar-live-hint')) return 'rdp-hint-stuck';
                // Группа дерева: иконка папки + шеврон; клик сворачивает —
                // шеврон поворачивается, папка меняется на закрытую (1 path) и обратно (2 path).
                const group = document.querySelector('.tree-group');
                if (!group) return 'no-group';
                const gFolder = group.querySelector('.tree-folder svg');
                const gChev = group.querySelector('.tree-chevron');
                if (!gFolder || gFolder.getBoundingClientRect().width < 8) return 'bad-group-folder';
                if (!gChev) return 'no-chevron';
                if (gChev.classList.contains('tree-chevron--closed')) return 'bad-open-chevron';
                if (gFolder.querySelectorAll('path').length !== 2) return 'bad-open-folder';
                group.click();
                await wait(150);
                const gChev2 = group.querySelector('.tree-chevron');
                const gFolder2 = group.querySelector('.tree-folder svg');
                if (!gChev2 || !gChev2.classList.contains('tree-chevron--closed')) return 'no-closed-chevron';
                if (!gFolder2 || gFolder2.querySelectorAll('path').length !== 1) return 'no-closed-folder';
                group.click(); // развернуть обратно
                await wait(120);
                // Drag-over группы: папка подсвечивается и «приоткрывается»,
                // уход мыши возвращает исходное состояние.
                const dragEvt = (type) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
                group.dispatchEvent(dragEvt('dragover'));
                await wait(150);
                const gFolder3 = group.querySelector('.tree-folder');
                if (!gFolder3 || !gFolder3.classList.contains('tree-folder--drag')) return 'no-drag-highlight';
                const ajarSvg = gFolder3.querySelector('svg');
                if (!ajarSvg || ajarSvg.querySelectorAll('path').length !== 2) return 'bad-ajar-folder';
                group.dispatchEvent(dragEvt('dragleave'));
                await wait(150);
                if (group.querySelector('.tree-folder--drag')) return 'drag-stuck';
                // Спиннер на кнопке массовой проверки: idle → refresh без вращения,
                // во время проверки → иконка с классом .icon-spin, после остановки → снова refresh.
                const bulkBtn = document.querySelector('.sidebar-header .btn');
                if (!bulkBtn) return 'no-bulk-btn';
                if (bulkBtn.querySelector('svg.icon-spin')) return 'bad-idle-spin';
                bulkBtn.click();
                let sawSpin = false;
                const spinDeadline = Date.now() + 4000;
                while (Date.now() < spinDeadline) {
                  if (bulkBtn.querySelector('svg.icon-spin')) { sawSpin = true; break; }
                  await wait(50);
                }
                if (!sawSpin) return 'no-spinner-during-check';
                bulkBtn.click(); // остановить проверку
                let backToRefresh = false;
                const stopDeadline = Date.now() + 2000;
                while (Date.now() < stopDeadline) {
                  if (!bulkBtn.querySelector('svg.icon-spin')) { backToRefresh = true; break; }
                  await wait(50);
                }
                if (!backToRefresh) return 'no-back-to-refresh';
                // Контекстное меню хоста: у пунктов должны быть иконки.
                const host = document.querySelector('.tree-host');
                if (!host) return 'no-host';
                host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 }));
                await wait(150);
                const ctxIcons = check('.ctxmenu-item');
                if (ctxIcons.length === 0) return 'no-ctxmenu';
                if (ctxIcons.some((s) => !s || s.w < 8)) return 'bad-ctx:' + JSON.stringify(ctxIcons);
                document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                await wait(100);
                // Диалог хоста: кнопки с иконками.
                const btns = [...document.querySelectorAll('.sidebar-footer .btn--sm')];
                const addHost = btns.find((b) => (b.textContent || '').includes('Хост'));
                if (!addHost) return 'no-add-host';
                addHost.click();
                const deadline = Date.now() + 6000;
                while (Date.now() < deadline) {
                  const m = document.querySelector('.modal');
                  if (m && (m.textContent || '').includes('Протокол')) break;
                  await wait(100);
                }
                const modalSvg = document.querySelector('.modal-close svg');
                const actions = check('.modal-actions .btn');
                if (!modalSvg || modalSvg.getBoundingClientRect().width < 8) return 'bad-modal-close';
                if (actions.some((s) => !s || s.w < 8)) return 'bad-actions:' + JSON.stringify(actions);
                return 'ok:footer=' + footer.length + ':ctx=' + ctxIcons.length + ':actions=' + actions.length + ':spinner=1:group=1:drag=1:counters=1:rdp-hint=1';
              })()
            `)
            .then(async (res) => {
              clearTimeout(watchdog);
              if (typeof res !== 'string' || !res.startsWith('ok:')) {
                console.error(`[smoke] icons flow failed: ${String(res)}`);
                app.exit(1);
                return;
              }
              // Справка: моки должны рисовать SVG-иконки набора (path с m-stroke-*),
              // текстовых глифов ▸▢↑↓✓ в справке не осталось.
              mainWindow?.webContents.send('menu:command', 'help');
              const helpRes = await mainWindow?.webContents.executeJavaScript(`
                (async () => {
                  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                  const deadline = Date.now() + 8000;
                  let h = null;
                  while (Date.now() < deadline) {
                    h = document.querySelector('.help');
                    if (h && (h.textContent || '').includes('Справка Remote Hub')) break;
                    await wait(100);
                  }
                  if (!h) return 'no-help';
                  for (const sec of ['Терминал', 'RDP, VNC и SFTP', 'Частые вопросы']) {
                    const item = [...document.querySelectorAll('.help-nav-item')].find((b) =>
                      (b.textContent || '').includes(sec)
                    );
                    if (!item) return 'no-nav:' + sec;
                    item.click();
                    await wait(250);
                    const mocks = [...document.querySelectorAll('.help-mock')];
                    if (mocks.length === 0) return 'no-mocks:' + sec;
                    const icons = mocks.reduce((n, m) => n + m.querySelectorAll('path[class*="m-stroke-"]').length, 0);
                    if (icons < 2) return 'few-icons:' + sec + ':' + icons;
                    const art = document.querySelector('.help-content');
                    if (art && /[▸▢↑↓✓]/.test(art.textContent || '')) return 'glyphs:' + sec;
                  }
                  return 'ok';
                })()
              `);
              if (helpRes !== 'ok') {
                console.error(`[smoke] icons flow failed: help check ${String(helpRes)}`);
                app.exit(1);
                return;
              }
              // О программе: клик по версии в статусбаре открывает диалог,
              // в котором есть версия приложения и changelog последнего релиза.
              const aboutRes = await mainWindow?.webContents.executeJavaScript(`
                (async () => {
                  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                  await wait(150);
                  const ver = document.querySelector('.statusbar-version');
                  if (!ver) return 'no-version-btn';
                  if (!ver.querySelector('svg')) return 'no-version-icon';
                  ver.click();
                  const deadline = Date.now() + 8000;
                  let m = null;
                  while (Date.now() < deadline) {
                    m = document.querySelector('.modal');
                    if (m && (m.textContent || '').includes('О программе')) break;
                    await wait(100);
                  }
                  if (!m) return 'no-about-dialog';
                  const text = m.textContent || '';
                  if (!/v\\d+\\.\\d+\\.\\d+/.test(text)) return 'no-about-version';
                  if (!text.includes('Что нового')) return 'no-about-changelog-title';
                  if (!text.includes('Версия ')) return 'no-about-changelog-version';
                  const items = m.querySelectorAll('.about-changelog-section li');
                  if (items.length === 0) return 'no-about-changelog-items';
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                  await wait(150);
                  if (document.querySelector('.modal')) return 'about-stuck';
                  return 'ok:items=' + items.length;
                })()
              `);
              if (typeof aboutRes !== 'string' || !aboutRes.startsWith('ok:')) {
                console.error(`[smoke] icons flow failed: about check ${String(aboutRes)}`);
                app.exit(1);
                return;
              }
              // Заставка и онбординг: версия приложения видна до готовности
              // (loading-version) и в тултипе тура (tour-tooltip-version).
              const uiVerRes = await mainWindow?.webContents.executeJavaScript(`
                (async () => {
                  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                  const store = window.__RH_STORE__;
                  if (!store) return 'no-store-hook';
                  // Заставка: показываем !ready, версия должна быть на экране.
                  store.setState({ ready: false });
                  await wait(200);
                  const splash = document.querySelector('.loading');
                  if (!splash) return 'no-splash';
                  const splashVer = (splash.querySelector('.loading-version')?.textContent || '').trim();
                  if (!/^Версия \\d+\\.\\d+\\.\\d+$/.test(splashVer)) return 'bad-splash-version:' + splashVer;
                  store.setState({ ready: true });
                  await wait(200);
                  // Онбординг: тултип тура показывает версию.
                  store.getState().openOnboarding();
                  await wait(250);
                  const tip = document.querySelector('.tour-tooltip');
                  if (!tip) return 'no-tour';
                  const tipVer = (tip.querySelector('.tour-tooltip-version')?.textContent || '').trim();
                  if (!/^v\\d+\\.\\d+\\.\\d+$/.test(tipVer)) return 'bad-tour-version:' + tipVer;
                  store.getState().closeOnboarding();
                  await wait(150);
                  if (document.querySelector('.tour-overlay')) return 'tour-stuck';
                  return 'ok';
                })()
              `);
              if (uiVerRes !== 'ok') {
                console.error(`[smoke] icons flow failed: ui-version check ${String(uiVerRes)}`);
                app.exit(1);
                return;
              }
              // «Что нового» после обновления: при старой lastSeenVersion
              // диалог открывается автоматически с changelog, версия запоминается.
              const wnRes = await mainWindow?.webContents.executeJavaScript(`
                (async () => {
                  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                  const store = window.__RH_STORE__;
                  if (!store) return 'no-store-hook';
                  const appVer = store.getState().appInfo?.version;
                  if (!appVer) return 'no-app-version';
                  // Сценарий обновления: запомнена старая версия.
                  await store.getState().patchSettings({ lastSeenVersion: '0.0.1' });
                  await wait(150);
                  await store.getState().maybeShowWhatsNew();
                  await wait(250);
                  const m = document.querySelector('.modal');
                  if (!m) return 'no-whatsnew-modal';
                  const text = m.textContent || '';
                  if (!text.includes('Что нового')) return 'no-whatsnew-title';
                  if (!text.includes('обновлён')) return 'no-whatsnew-subtitle';
                  const items = m.querySelectorAll('.about-changelog-section li');
                  if (items.length === 0) return 'no-whatsnew-items';
                  // Версия запомнена после показа — повторно не откроется.
                  if (store.getState().settings.lastSeenVersion !== appVer)
                    return 'last-seen-not-saved:' + store.getState().settings.lastSeenVersion;
                  // Закрыть и убедиться, что повторный вызов ничего не открывает.
                  m.querySelector('.modal-close')?.click();
                  await wait(150);
                  await store.getState().maybeShowWhatsNew();
                  await wait(150);
                  if (document.querySelector('.modal')) return 'whatsnew-reopened';
                  // Чистый первый запуск: онбординг не пройден, версии нет — без диалога.
                  await store.getState().patchSettings({ lastSeenVersion: null, onboardingDone: false });
                  await wait(150);
                  await store.getState().maybeShowWhatsNew();
                  await wait(150);
                  if (document.querySelector('.modal')) return 'whatsnew-on-fresh';
                  if (store.getState().settings.lastSeenVersion !== appVer)
                    return 'fresh-not-recorded:' + store.getState().settings.lastSeenVersion;
                  // Вернуть сид-состояние для последующих смоуков.
                  await store.getState().patchSettings({ onboardingDone: true });
                  return 'ok';
                })()
              `);
              if (wnRes === 'ok') {
                console.log(
                  `[smoke] icons flow OK — ${String(res).slice(3)}:help=1:about=1:ui-version=1:whatsnew=1 (${String(aboutRes).slice(3)})`
                );
                app.exit(0);
              } else {
                console.error(`[smoke] icons flow failed: whatsnew check ${String(wnRes)}`);
                app.exit(1);
              }
            });
          return;
        }
        // Автообновление: баннер UpdateBar отображает все состояния,
        // release notes раскрываются, а «Проверить обновления» в «О программе»
        // вызывает checkUpdates из стора.
        if (process.env.RH_SMOKE_UPDATE === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const store = window.__RH_STORE__;
                if (!store) return 'no-store-hook';
                const setUpdate = (u) => store.setState({ update: u });
                const bar = () => document.querySelector('.update-bar');
                const barText = () => (bar() ? (bar().textContent || '').replace(/\\s+/g, ' ').trim() : '');

                // checking
                setUpdate({ status: 'checking' });
                await wait(120);
                if (!bar()) return 'no-bar-checking';
                if (!bar().querySelector('svg.icon-spin')) return 'no-spin-checking';
                if (!barText().includes('Проверка обновлений')) return 'bad-text-checking:' + barText();

                // available + release notes раскрываются по клику
                setUpdate({ status: 'available', version: '9.9.9', releaseNotes: 'Исправлено всё\\nДобавлено новое' });
                await wait(120);
                if (!barText().includes('Доступна версия')) return 'bad-text-available:' + barText();
                if (!barText().includes('9.9.9')) return 'no-version-available';
                const toggle = bar().querySelector('.update-bar__notes-toggle');
                if (!toggle) return 'no-notes-toggle';
                if (bar().querySelector('.update-bar__notes')) return 'notes-open-by-default';
                toggle.click();
                await wait(120);
                const notes = bar().querySelector('.update-bar__notes');
                if (!notes) return 'no-notes-after-click';
                if (!notes.textContent.includes('Исправлено всё')) return 'bad-notes:' + notes.textContent;
                const dlBtn = [...bar().querySelectorAll('button')].find((b) => (b.textContent || '').includes('Скачать'));
                if (!dlBtn) return 'no-download-btn';

                // downloading
                setUpdate({ status: 'downloading', percent: 42, bytesPerSecond: 1000 });
                await wait(120);
                if (!barText().includes('42%')) return 'bad-downloading:' + barText();
                if (!bar().querySelector('.update-bar__progress-fill')) return 'no-progress';

                // downloaded
                setUpdate({ status: 'downloaded', version: '9.9.9' });
                await wait(120);
                if (!barText().includes('готова к установке')) return 'bad-downloaded:' + barText();
                const installBtn = [...bar().querySelectorAll('button')].find((b) =>
                  (b.textContent || '').includes('Перезапустить')
                );
                if (!installBtn) return 'no-install-btn';

                // error → повторная проверка вызывает checkUpdates
                let checkCalls = 0;
                const origCheck = store.getState().checkUpdates;
                store.setState({ checkUpdates: async () => { checkCalls++; } });
                setUpdate({ status: 'error', message: 'net down' });
                await wait(120);
                if (!barText().includes('Ошибка обновления')) return 'bad-error:' + barText();
                const retryBtn = [...bar().querySelectorAll('button')].find((b) => (b.textContent || '').includes('Повторить'));
                if (!retryBtn) return 'no-retry-btn';
                retryBtn.click();
                await wait(120);
                if (checkCalls !== 1) return 'retry-no-check:' + checkCalls;
                store.setState({ checkUpdates: origCheck });

                // not-available и idle — баннер скрыт
                setUpdate({ status: 'not-available' });
                await wait(120);
                if (bar()) return 'bar-visible-not-available';
                setUpdate({ status: 'idle' });
                await wait(120);
                if (bar()) return 'bar-visible-idle';

                // «О программе»: секция обновлений + кнопка «Проверить обновления»
                setUpdate({ status: 'idle' });
                const verBtn = document.querySelector('.statusbar-version');
                if (!verBtn) return 'no-version-btn';
                verBtn.click();
                const deadline = Date.now() + 8000;
                let m = null;
                while (Date.now() < deadline) {
                  m = document.querySelector('.modal');
                  if (m && (m.textContent || '').includes('О программе')) break;
                  await wait(100);
                }
                if (!m) return 'no-about-modal';
                const aboutText = m.textContent || '';
                if (!aboutText.includes('Обновления')) return 'no-about-update-section';
                let aboutCalls = 0;
                const origAboutCheck = store.getState().checkUpdates;
                store.setState({ checkUpdates: async () => { aboutCalls++; } });
                await wait(150); // перерисовка с новой функцией из стора
                const aboutCheckBtn = [...m.querySelectorAll('button')].find((b) =>
                  (b.textContent || '').includes('Проверить обновления')
                );
                if (!aboutCheckBtn) return 'no-about-check-btn';
                aboutCheckBtn.click();
                await wait(150);
                if (aboutCalls !== 1) return 'about-btn-no-check:' + aboutCalls;
                store.setState({ checkUpdates: origAboutCheck });
                return 'ok:states=checking+available+downloading+downloaded+error+about';
              })()
            `)
            .then((res) => {
              clearTimeout(watchdog);
              if (typeof res === 'string' && res.startsWith('ok:')) {
                console.log(`[smoke] update flow OK — ${String(res).slice(3)}`);
                app.exit(0);
              } else {
                console.error(`[smoke] update flow failed: ${String(res)}`);
                app.exit(1);
              }
            });
          return;
        }
        // Контраст иконок и кнопок-иконок: обе темы × все акцентные цвета.
        // Порог 3:1 (WCAG 1.4.11 для нетекстовых элементов); ловит светлые
        // акценты (жёлтый, циан, фиолетовый) и слабые кнопки-иконки.
        if (process.env.RH_SMOKE_CONTRAST === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const store = window.__RH_STORE__;
                if (!store) return 'no-store-hook';
                const ACCENTS = ['#2d95ec', '#57ab5a', '#c678dd', '#e5534b', '#d29922', '#39c5cf'];
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                // Парсит вычисленные цвета: rgb()/rgba(), color(srgb …),
                // и неразрешённый color-mix(in srgb, …) — Chromium иногда
                // возвращает его как есть.
                const parseColor = (str) => {
                  if (!str) return null;
                  const s = String(str).trim();
                  let m = s.match(/^rgba?\\(([^)]+)\\)$/i);
                  if (m) {
                    const p = m[1].split(/[,\s/]+/).map((x) => parseFloat(x));
                    if (p.length >= 3 && !isNaN(p[0])) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
                    return null;
                  }
                  m = s.match(/^color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)$/i);
                  if (m) return { r: m[1] * 255, g: m[2] * 255, b: m[3] * 255, a: m[4] != null ? m[4] : 1 };
                  m = s.match(/^color-mix\\(in srgb,\\s*([^,]+?)\\s+([\\d.]+)%\\s*,\\s*([^)]+?)\\s+([\\d.]+)%\\s*\\)$/i);
                  if (m) {
                    const a = parseColor(m[1]);
                    const b = parseColor(m[3]);
                    if (a && b) {
                      const t = parseFloat(m[2]) / (parseFloat(m[2]) + parseFloat(m[4]) || 1);
                      return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t };
                    }
                  }
                  return null;
                };
                const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
                const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
                const ratio = (a, b) => {
                  const la = lum(a), lb = lum(b);
                  const hi = Math.max(la, lb), lo = Math.min(la, lb);
                  return (hi + 0.05) / (lo + 0.05);
                };
                const effBg = (el) => {
                  let cur = { r: 0, g: 0, b: 0, a: 0 };
                  let node = el;
                  while (node && node !== document.documentElement) {
                    const bg = parseColor(getComputedStyle(node).backgroundColor);
                    if (bg && bg.a > 0) {
                      const a = bg.a + cur.a * (1 - bg.a);
                      cur = {
                        r: (bg.r * bg.a + cur.r * cur.a * (1 - bg.a)) / (a || 1),
                        g: (bg.g * bg.a + cur.g * cur.a * (1 - bg.a)) / (a || 1),
                        b: (bg.b * bg.a + cur.b * cur.a * (1 - bg.a)) / (a || 1),
                        a
                      };
                      if (a >= 0.999) break;
                    }
                    node = node.parentElement;
                  }
                  if (cur.a < 1) {
                    const body = parseColor(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
                    const a = body.a + cur.a * (1 - body.a);
                    cur = {
                      r: (body.r * body.a + cur.r * cur.a * (1 - body.a)) / (a || 1),
                      g: (body.g * body.a + cur.g * cur.a * (1 - body.a)) / (a || 1),
                      b: (body.b * body.a + cur.b * cur.a * (1 - body.a)) / (a || 1),
                      a
                    };
                  }
                  return cur;
                };
                // Эффективный цвет с учётом прозрачности самого элемента.
                const effColor = (el) => {
                  const cs = getComputedStyle(el);
                  const c = parseColor(cs.color);
                  if (!c) return null;
                  const o = parseFloat(cs.opacity || '1');
                  if (o >= 1) return c;
                  const bg = effBg(el);
                  return {
                    r: c.r * o + bg.r * (1 - o),
                    g: c.g * o + bg.g * (1 - o),
                    b: c.b * o + bg.b * (1 - o),
                    a: 1
                  };
                };
                const scan = () => {
                  const items = [];
                  const add = (el, label, min) => {
                    const bg = effBg(el);
                    const c = effColor(el);
                    if (!c) return; // цвет не распознан — не судим
                    items.push({ label, ratio: Math.round(ratio(c, bg) * 100) / 100, min });
                  };
                  document.querySelectorAll('.tabbar-new').forEach((el, i) => add(el, 'tabbar-new:' + i, 3));
                  document.querySelectorAll('.btn--icon').forEach((el, i) => add(el, 'btn-icon:' + i, 3));
                  document.querySelectorAll('.ctxmenu-item').forEach((el, i) => add(el, 'ctxmenu:' + i, 3));
                  document.querySelectorAll('.ctxmenu-icon').forEach((el, i) => add(el, 'ctxmenu-icon:' + i, 3));
                  document.querySelectorAll('.tree-tag').forEach((el, i) => add(el, 'tree-tag:' + i, 3));
                  document.querySelectorAll('.tree-folder').forEach((el, i) => add(el, 'tree-folder:' + i, 3));
                  document.querySelectorAll('.tree-chevron').forEach((el, i) => add(el, 'tree-chevron:' + i, 3));
                  document.querySelectorAll('.statusbar-item').forEach((el, i) => add(el, 'statusbar:' + i, 3));
                  document.querySelectorAll('.seg-btn--active').forEach((el, i) => add(el, 'seg-active:' + i, 3));
                  document.querySelectorAll('.sidebar-footer .btn--active').forEach((el, i) => add(el, 'footer-active:' + i, 3));
                  document.querySelectorAll('.btn--primary').forEach((el, i) => add(el, 'btn-primary:' + i, 3));
                  return items;
                };
                // Открыть панели, чтобы в скане были все виды кнопок.
                const btns = [...document.querySelectorAll('.sidebar-footer .btn--sm')];
                const settingsBtn = btns.find((b) => (b.textContent || '').includes('Настройки'));
                if (settingsBtn) settingsBtn.click();
                const addHost = btns.find((b) => (b.textContent || '').includes('Хост'));
                if (addHost) addHost.click();
                const host = document.querySelector('.tree-host');
                if (!host) return 'no-host';
                host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 }));
                await wait(350);
                const fails = [];
                const report = [];
                for (const theme of ['dark', 'light']) {
                  for (const accent of ACCENTS) {
                    store.getState().patchSettings({ theme, accent });
                    await wait(140);
                    const items = scan();
                    if (items.length === 0) return 'no-elements:' + theme + ':' + accent;
                    for (const it of items) {
                      if (it.ratio < it.min) fails.push({ theme, accent, label: it.label, ratio: it.ratio });
                    }
                    const worst = items.slice().sort((a, b) => a.ratio - b.ratio)[0];
                    report.push(theme + ':' + accent + '=' + worst.ratio);
                    // Hover-контраст: фон --accent-hover, текст/иконка --accent-fg.
                    const rs = getComputedStyle(document.documentElement);
                    const hovFg = parseColor(rs.getPropertyValue('--accent-fg'));
                    const hovBg = parseColor(rs.getPropertyValue('--accent-hover'));
                    if (hovFg && hovBg) {
                      const hr = ratio(hovFg, hovBg);
                      if (hr < 3) fails.push({ theme, accent, label: 'hover:btn--primary', ratio: Math.round(hr * 100) / 100 });
                    }
                  }
                }
                if (fails.length > 0) return 'fail:' + JSON.stringify(fails.slice(0, 24));
                return 'ok:' + report.join(' ');
              })()
            `)
            .then((res) => {
              clearTimeout(watchdog);
              if (typeof res === 'string' && res.startsWith('ok:')) {
                console.log(`[smoke] contrast flow OK — ${String(res).slice(3)}`);
                app.exit(0);
              } else {
                console.error(`[smoke] contrast flow failed: ${String(res)}`);
                app.exit(1);
              }
            });
          return;
        }
        // SFTP: реальный список каталога через fake-сервер — иконки файла/папки,
        // передача с иконкой направления и завершение с галочкой.
        if (process.env.RH_SMOKE_SFTP === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const log = (m) => console.log('[sftp-smoke]', m);
                const hostRow = document.querySelector('.tree-host');
                if (!hostRow) return 'no-host';
                hostRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 120 }));
                let sftpItem = null;
                const d1 = Date.now() + 6000;
                while (Date.now() < d1) {
                  sftpItem = [...document.querySelectorAll('.ctxmenu-item')].find((b) => (b.textContent || '').includes('SFTP'));
                  if (sftpItem) break;
                  await wait(100);
                }
                if (!sftpItem) return 'no-sftp-item';
                log('clicking sftp item');
                sftpItem.click();
                // Ждём список каталога (папка var + файлы) — только удалённая колонка.
                let rows = [];
                const d2 = Date.now() + 20000;
                while (Date.now() < d2) {
                  rows = [...document.querySelectorAll('.sftp-pane-col--remote .sftp-row')];
                  if (rows.length >= 3) break;
                  await wait(150);
                }
                log('remote-rows=' + rows.length);
                if (rows.length < 3) return 'no-rows:' + rows.length;
                const dirRow = rows.find((r) => r.querySelector('.sftp-ico--dir'));
                const fileRow = rows.find((r) => !r.querySelector('.sftp-ico--dir'));
                if (!dirRow || !fileRow) return 'no-ico-kinds';
                const dirD = (dirRow.querySelector('.sftp-ico svg path') || {}).getAttribute?.('d') || '';
                const fileD = (fileRow.querySelector('.sftp-ico svg path') || {}).getAttribute?.('d') || '';
                if (!dirD.startsWith('M2.2 4.2')) return 'bad-dir-icon:' + dirD.slice(0, 24);
                if (!fileD.startsWith('M3.2 2.4')) return 'bad-file-icon:' + fileD.slice(0, 24);
                // Скачивание файла: двойной клик по строке файла (удалённая сторона).
                fileRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                let sawDownload = false;
                const d3 = Date.now() + 20000;
                while (Date.now() < d3) {
                  const op = document.querySelector('.sftp-op');
                  if (op) {
                    const ic = op.querySelector('.sftp-op-name svg path');
                    if (ic && (ic.getAttribute('d') || '').startsWith('M8 2.6')) { sawDownload = true; break; }
                  }
                  await wait(150);
                }
                log('download op seen');
                if (!sawDownload) return 'no-download-op';
                let sawDone = false;
                const d4 = Date.now() + 20000;
                while (Date.now() < d4) {
                  const op = document.querySelector('.sftp-op--done');
                  if (op) {
                    const chk = op.querySelector('.sftp-op-meta svg path');
                    if (chk && (chk.getAttribute('d') || '').startsWith('M3 8.4')) { sawDone = true; break; }
                  }
                  await wait(150);
                }
                if (!sawDone) return 'no-done-check';
                return 'ok:rows=' + rows.length;
              })()
            `)
            .then((res) => {
              clearTimeout(watchdog);
              if (typeof res === 'string' && res.startsWith('ok:')) {
                console.log(`[smoke] sftp flow OK — ${String(res).slice(3)}`);
                app.exit(0);
              } else {
                console.error(`[smoke] sftp flow failed: ${String(res)}`);
                app.exit(1);
              }
            })
            .catch((err) => {
              clearTimeout(watchdog);
              console.error(`[smoke] sftp flow rejected: ${String(err && err.message ? err.message : err)}`);
              app.exit(1);
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
        // Управление разрешением встроенной RDP-сессии прямо из вкладки:
        // окно → «Полный экран» → «Встроить во вкладку» → смена разрешения.
        if (process.env.RH_SMOKE_RDP_RESOLUTION === '1') {
          await mainWindow?.webContents
            .executeJavaScript(`
              (async () => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const deadline = Date.now() + 90000;
                const until = async (pred) => {
                  while (Date.now() < deadline) {
                    const v = pred();
                    if (v) return v;
                    await wait(200);
                  }
                  return null;
                };
                const host = document.querySelector('.tree-host');
                if (!host) return 'no-host';
                host.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                if (!(await until(() => (document.querySelector('.rdp-pane--embedded') ? true : null)))) return 'no-embedded';
                // 1. Полный экран: сессия перезапускается, вкладка уходит в фолбэк.
                const fsBtn = [...document.querySelectorAll('.rdp-toolbar .btn')].find((b) =>
                  (b.textContent || '').includes('Полный экран')
                );
                if (!fsBtn) return 'no-fs-btn';
                fsBtn.click();
                if (!(await until(() => (document.querySelector('.rdp-pane--fallback') ? true : null)))) return 'no-fallback';
                // 2. Обратно во вкладку.
                const embedBtn = [...document.querySelectorAll('.rdp-pane--fallback .btn')].find((b) =>
                  (b.textContent || '').includes('Встроить во вкладку')
                );
                if (!embedBtn) return 'no-embed-btn';
                embedBtn.click();
                if (!(await until(() => (document.querySelector('.rdp-pane--embedded') ? true : null)))) return 'no-reembedded';
                // 3. Смена разрешения: сессия переподключается с новым desktopwidth/height.
                const sel = document.querySelector('.rdp-toolbar select');
                if (!sel) return 'no-res-select';
                const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
                setter.call(sel, '1024×768');
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                if (!(await until(() => (document.querySelector('.rdp-pane--embedded') ? true : null)))) return 'no-res-reconnect';
                await wait(300);
                const res = document.querySelector('.rdp-toolbar select')?.value || '';
                return 'ok:res=' + res;
              })()
            `)
            .then((res) => {
              clearTimeout(watchdog);
              if (typeof res === 'string' && res.startsWith('ok:')) {
                console.log(`[smoke] rdp resolution OK — окно → полный экран → окно, разрешение ${String(res).slice(3)}`);
                app.exit(0);
              } else {
                console.error(`[smoke] rdp resolution flow failed: ${String(res)}`);
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
        // Сценарий справки: меню → диалог с оглавлением.
        if (process.env.RH_SMOKE_HELP === '1') {
          mainWindow?.webContents.send('menu:command', 'help');
          const res = await mainWindow?.webContents.executeJavaScript(`
            (async () => {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              const deadline = Date.now() + 6000;
              while (Date.now() < deadline) {
                const h = document.querySelector('.help');
                if (h) {
                  const sections = document.querySelectorAll('.help-nav-item').length;
                  const title = document.querySelector('.help-section-title')?.textContent || '';
                  return 'ok:' + sections + ':' + title;
                }
                await wait(100);
              }
              return 'no-help';
            })()
          `);
          clearTimeout(watchdog);
          if (typeof res === 'string' && res.startsWith('ok:')) {
            const parts = res.split(':');
            console.log(`[smoke] help flow OK — справка открылась, разделов: ${parts[1]}, первый: ${parts[2]}`);
            app.exit(0);
          } else {
            console.error(`[smoke] help flow failed: ${String(res)}`);
            app.exit(1);
          }
          return;
        }
        // Авто-открытие раздела «Неполадки» при первой ошибке подключения.
        if (process.env.RH_SMOKE_AUTO_HELP === '1') {
          const res = await mainWindow?.webContents.executeJavaScript(`
            (async () => {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              const input = document.querySelector('.quick-connect-input');
              if (!input) return 'no-input';
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(input, 'root@127.0.0.1:1');
              input.dispatchEvent(new Event('input', { bubbles: true }));
              await wait(200);
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
              const deadline = Date.now() + 20000;
              while (Date.now() < deadline) {
                const h = document.querySelector('.help');
                if (h) {
                  const title = document.querySelector('.help-section-title')?.textContent || '';
                  if (title.includes('Частые вопросы')) return 'ok:' + title;
                }
                await wait(200);
              }
              return 'no-auto-help';
            })()
          `);
          clearTimeout(watchdog);
          if (typeof res === 'string' && res.startsWith('ok:')) {
            console.log(`[smoke] auto-help OK — справка открылась на разделе «${String(res).slice(3)}»`);
            app.exit(0);
          } else {
            console.error(`[smoke] auto-help failed: ${String(res)}`);
            app.exit(1);
          }
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
    store = new Store(app.getPath('userData'), dpapiSealer);
    const broadcast = (channel: string, payload: unknown): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, payload);
      }
    };
    const sessions = new SessionManager(dpapiSealer, broadcast as (c: 'session:data' | 'session:state', p: unknown) => void);
    const getParentHwnd = (): number | null => {
      if (!mainWindow || mainWindow.isDestroyed()) return null;
      try {
        return mainWindow.getNativeWindowHandle().readUInt32LE(0);
      } catch {
        return null;
      }
    };
    const rdp = new RdpManager({
      sealer: dpapiSealer,
      send: broadcast as (c: 'rdp:exited', p: unknown) => void,
      getParentHwnd,
      autoAcceptCert: store.loadSettings().data.rdpAutoAcceptCert
    });
    const vnc = new VncManager(dpapiSealer, (sessionId, message) => {
      broadcast('vnc:error', { sessionId, message });
    });
    const sftp = new SftpManager(dpapiSealer);
    const tunnels = new TunnelManager(dpapiSealer);
    const updater = new Updater(broadcast);
    installMenu(updater);
    registerIpc(store, sessions, rdp, vnc, sftp, tunnels, updater);
    app.on('before-quit', () => {
      sessions.closeAll();
      rdp.closeAll();
      vnc.closeAll();
      sftp.closeAll();
      tunnels.closeAll();
      updater.dispose();
    });
    createWindow(rdp);
    updater.start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(rdp);
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
