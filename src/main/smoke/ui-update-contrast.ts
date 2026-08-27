import { app, type BrowserWindow } from 'electron';

/**
 * Автообновление: баннер UpdateBar отображает все состояния,
 * release notes раскрываются, а «Проверить обновления» в «О программе»
 * вызывает checkUpdates из стора.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_UPDATE).
 */
export async function runUpdateFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_UPDATE !== '1') return false;

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
  return true;
}

/**
 * Контраст иконок и кнопок-иконок: обе темы × все акцентные цвета.
 * Порог 3:1 (WCAG 1.4.11 для нетекстовых элементов); ловит светлые
 * акценты (жёлтый, циан, фиолетовый) и слабые кнопки-иконки.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_CONTRAST).
 */
export async function runContrastFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_CONTRAST !== '1') return false;

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
  return true;
}
