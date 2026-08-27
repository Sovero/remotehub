import { app, type BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Скриншот UI: открывает выбранные RH_SHOT_* панели/диалоги и сохраняет
 * итоговый снимок окна.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_SCREENSHOT).
 */
export async function runScreenshotFlow(mainWindow: BrowserWindow | null): Promise<boolean> {
  if (process.env.RH_SMOKE_SCREENSHOT !== '1') return false;

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
                    const m = document.querySelector('.modal');
                    if (m && (m.textContent || '').includes('Акцентный цвет')) return 'ok';
                    await wait(100);
                  }
                  return 'no-settings-modal';
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
    return true;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, image.toPNG());
  console.log(`[smoke] screenshot saved: ${outPath} (${image.getSize().width}x${image.getSize().height})`);
  app.exit(0);
  return true;
}
