import { app, type BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Генерация реальных скриншотов для встроенной справки (npm run help:shots).
 * Перенесено дословно из src/main/index.ts (ветка RH_CAPTURE_HELP).
 */
export async function runCaptureHelpFlow(
  mainWindow: BrowserWindow | null,
  watchdog: NodeJS.Timeout
): Promise<boolean> {
  if (process.env.RH_CAPTURE_HELP !== '1') return false;

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
      js: `(async () => { ${waitProbe} const btn = document.querySelector('.sidebar-footer [title="Настройки"]'); if (!btn) return 'no-btn'; btn.click(); const deadline = Date.now() + 6000; while (Date.now() < deadline) { const m = document.querySelector('.modal'); if (m && (m.textContent || '').includes('Акцентный цвет')) return 'ok'; await wait(100); } return 'no-modal'; })()`,
      close: closeModal
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
  return true;
}
