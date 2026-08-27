import { app, type BrowserWindow } from 'electron';

/**
 * VNC smoke-flow: подключение к фейковому серверу, ожидание живого кадра canvas.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_VNC).
 */
export async function runVncFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_VNC !== '1') return false;

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
  return true;
}

/**
 * Ошибка рукопожатия VNC: сервер молчит → вкладка показывает понятный оверлей.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_VNC_ERROR).
 */
export async function runVncErrorFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_VNC_ERROR !== '1') return false;

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
  return true;
}

/**
 * SFTP: реальный список каталога через fake-сервер — иконки файла/папки,
 * передача с иконкой направления и завершение с галочкой.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_SFTP).
 */
export async function runSftpFlow(mainWindow: BrowserWindow | null, watchdog: NodeJS.Timeout): Promise<boolean> {
  if (process.env.RH_SMOKE_SFTP !== '1') return false;

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
  return true;
}

/**
 * Сценарий SFTP/туннелей: SSH-вкладка → диалог туннелей → SFTP-панель
 * через контекстное меню (порт мёртвый, проверяем путь до ошибки UI).
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_SFTP_TUNNELS).
 */
export async function runSftpTunnelsFlow(
  mainWindow: BrowserWindow | null,
  watchdog: NodeJS.Timeout
): Promise<boolean> {
  if (process.env.RH_SMOKE_SFTP_TUNNELS !== '1') return false;

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
  return true;
}
