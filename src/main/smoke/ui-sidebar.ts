import { app, type BrowserWindow } from 'electron';
import type { Store } from '../store';
import { captureAndSave } from './shot-util';

/**
 * Сценарий «схлопывание левой панели» (RH_SMOKE_SIDEBAR=1).
 *
 * Проверяет на живом приложении:
 *  - дефолт: сетка .app 280px, кнопки подвала «иконка + подпись»;
 *  - клик по «Свернуть панель» → app--sidebar-collapsed, колонка 46px,
 *    поиск скрыт, в подвале 9 кнопок-иконок с title и svg, без текста;
 *  - состояние пережило запись в настройки (Store, sidebarCollapsed=true);
 *  - Ctrl+B разворачивает обратно: сетка 280px, подписи вернулись,
 *    sidebarCollapsed=false в файле настроек;
 *  - скриншот свёрнутого рельса сохраняется перед разворотом.
 */
export async function runSidebarCollapseFlow(mainWindow: BrowserWindow, store: Store): Promise<boolean> {
  if (process.env.RH_SMOKE_SIDEBAR !== '1') return false;

  const result = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const app = document.querySelector('.app');
      if (!app) return 'no-app';

      // --- дефолт: развёрнутая панель ---
      const cols0 = getComputedStyle(app).gridTemplateColumns;
      if (!cols0.startsWith('280px')) return 'default-cols:' + cols0;
      const foot0 = [...document.querySelectorAll('.sidebar-footer .btn')];
      if (foot0.length !== 9) return 'footer-count:' + foot0.length;
      if (!foot0.every((b) => (b.textContent || '').trim().length > 0)) return 'footer-no-labels';
      const collapseBtn = document.querySelector('.sidebar-header button[title^="Свернуть"]');
      if (!collapseBtn) return 'no-collapse-btn';

      // --- сворачиваем кликом ---
      collapseBtn.click();
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline && !app.classList.contains('app--sidebar-collapsed')) await wait(100);
      if (!app.classList.contains('app--sidebar-collapsed')) return 'no-collapsed-class';
      await wait(150);

      const cols1 = getComputedStyle(app).gridTemplateColumns;
      if (!cols1.startsWith('46px')) return 'collapsed-cols:' + cols1;
      if (document.querySelector('.sidebar-search')) return 'search-still-visible';
      const foot1 = [...document.querySelectorAll('.sidebar-footer .btn')];
      if (foot1.length !== 9) return 'rail-footer-count:' + foot1.length;
      if (!foot1.every((b) => (b.textContent || '').trim().length === 0)) return 'rail-footer-has-text';
      if (!foot1.every((b) => b.querySelector('svg') && (b.getAttribute('title') || '').length > 0)) {
        return 'rail-footer-no-icon-or-title';
      }
      const expandBtn = document.querySelector('.sidebar-header button[title^="Развернуть"]');
      if (!expandBtn) return 'no-expand-btn';
      return 'ok';
    })()
  `);

  if (result !== 'ok') {
    console.error(`[smoke] sidebar: default/collapsed check failed → ${String(result)}`);
    app.exit(1);
    return true; // сценарий свой — наверх не передаём управление
  }

  // --- персистентность: решение о сворачивании дошло до файла настроек ---
  const persistedCollapsed = store.loadSettings().data.sidebarCollapsed;
  if (persistedCollapsed !== true) {
    console.error('[smoke] sidebar: sidebarCollapsed=true не сохранился в settings');
    app.exit(1);
    return true;
  }

  // Скриншот свёрнутого рельса (до разворота).
  await captureAndSave(mainWindow, 'sidebar-collapsed.png');

  // --- разворот синтетическим Ctrl+B ---
  const expand = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const app = document.querySelector('.app');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline && app.classList.contains('app--sidebar-collapsed')) await wait(100);
      if (app.classList.contains('app--sidebar-collapsed')) return 'still-collapsed';
      const cols = getComputedStyle(app).gridTemplateColumns;
      if (!cols.startsWith('280px')) return 'expanded-cols:' + cols;
      const foot = [...document.querySelectorAll('.sidebar-footer .btn')];
      if (foot.length !== 9 || !foot.every((b) => (b.textContent || '').trim().length > 0)) {
        return 'expanded-footer-broken';
      }
      if (!document.querySelector('.sidebar-search input')) return 'search-not-back';
      return 'ok';
    })()
  `);

  if (expand !== 'ok') {
    console.error(`[smoke] sidebar: expand via Ctrl+B failed → ${String(expand)}`);
    app.exit(1);
    return true;
  }

  const persistedExpanded = store.loadSettings().data.sidebarCollapsed;
  if (persistedExpanded !== false) {
    console.error('[smoke] sidebar: sidebarCollapsed=false не сохранился после разворота');
    app.exit(1);
    return true;
  }

  console.log('[smoke] sidebar collapse/expand: OK (persisted both ways, rail is icon-only with titles)');
  app.exit(0);
  return true;
}
