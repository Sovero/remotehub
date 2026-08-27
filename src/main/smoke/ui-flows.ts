import { app, type BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Сценарий учётных данных: набор виден, пароль не утекает в DOM.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_CRED).
 */
export async function runCredFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_CRED !== '1') return false;

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
  return true;
}

/**
 * Сценарий сниппетов: поповер со сниппетом открывается по кнопке в таббаре.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_SNIPS).
 */
export async function runSnipsFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_SNIPS !== '1') return false;

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
  return true;
}

/**
 * Сценарий «Проверить доступность»: контекстное меню хоста → тултип с результатом.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_AVAIL).
 */
export async function runAvailFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_AVAIL !== '1') return false;

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
  return true;
}

/**
 * Сценарий темы/акцента: настройки из сайдбара → светлая тема → акцент.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_THEME).
 */
export async function runThemeFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_THEME !== '1') return false;

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
                  const p = document.querySelector('.modal');
                  return p && (p.textContent || '').includes('Акцентный цвет') ? p : null;
                });
                if (!panel) return 'no-settings-panel';
                if (!document.querySelector('.modal-overlay')) return 'no-modal-overlay';
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
                  settingsModal: css('.modal'),
                  tabbar: css('.tabbar'),
                  main: css('main'),
                  modal: css('.modal')
                });
                const ok = accent.toLowerCase() === '#57ab5a' && bodyBg !== 'rgb(23, 24, 28)';
                // 4. Возврат к дереву: крестик в шапке модального окна.
                const closeBtn = document.querySelector('.modal-close');
                if (!closeBtn) return 'no-close-btn';
                closeBtn.click();
                await wait(150);
                if (!document.querySelector('.modal') && document.querySelector('.tree-host, .sidebar-empty')) {
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
  return true;
}

/**
 * Сценарий справки: меню → диалог с оглавлением.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_HELP).
 */
export async function runHelpFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_HELP !== '1') return false;

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
  return true;
}

/**
 * Авто-открытие раздела «Неполадки» при первой ошибке подключения.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_AUTO_HELP).
 */
export async function runAutoHelpFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_AUTO_HELP !== '1') return false;

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
  return true;
}

/**
 * Проверка восстановленных вкладок (RH_EXPECT_TABS): используется совместно
 * с RH_SMOKE для сценария восстановления сессии при старте.
 * Перенесено дословно из src/main/index.ts (ветка expectTabs).
 */
export async function runExpectTabsFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  const expectTabs = Number(process.env.RH_EXPECT_TABS ?? -1);
  if (expectTabs < 0) return false;

  const tabRows = await mainWindow?.webContents.executeJavaScript(
    'document.querySelectorAll(".tab").length'
  );
  console.log(`[smoke] restored tabs in DOM: ${String(tabRows)}`);
  if (tabRows !== expectTabs) {
    console.error(`[smoke] expected ${expectTabs} restored tabs, got ${String(tabRows)}`);
    app.exit(1);
    return true;
  }
  clearTimeout(watchdog);
  app.exit(0);
  return true;
}

/**
 * Сценарий сессии: двойной клик по первому хосту, ждём оверлей ошибки.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_SESSION).
 */
export async function runSessionFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_SESSION !== '1') return false;

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
  return true;
}
