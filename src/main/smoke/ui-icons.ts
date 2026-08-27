import { app, type BrowserWindow } from 'electron';

/**
 * Иконки в кнопках: после добавления Icon-компонента кнопки не должны
 * терять содержимое, а svg — рендериться с ненулевым размером.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_ICONS).
 */
export async function runIconsFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_ICONS !== '1') return false;

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
  return true;
}
