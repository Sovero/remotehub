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
            },
            {
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
                          return 'ok:canvas=' + canvas.width + 'x' + canvas.height + ':colored=' + nonBlack;
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
