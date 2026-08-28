import { app, type BrowserWindow } from 'electron';

/**
 * IronRDP smoke-flow: подключение к реальному хосту, ожидание живого кадра canvas.
 * Перенесено дословно из src/main/index.ts (ветка RH_SMOKE_RDP_IRON).
 */
export async function runRdpIronFlow(
  mainWindow: BrowserWindow | null,
  watchdog: NodeJS.Timeout
): Promise<boolean> {
  if (process.env.RH_SMOKE_RDP_IRON !== '1') return false;

  clearTimeout(watchdog);
  const timeoutMs = Math.max(1000, Number(process.env.RH_RDP_TIMEOUT_MS ?? 90000) || 90000);
  await mainWindow?.webContents
    .executeJavaScript(`
              (async () => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const deadline = Date.now() + ${timeoutMs};
                const host = document.querySelector('.tree-host');
                if (!host) return 'no-host';
                const store = window.__RH_STORE__;
                const configuredEngine = store && store.getState ? store.getState().settings?.rdpEngine : null;
                if (configuredEngine !== 'iron') return 'wrong-engine:' + String(configuredEngine);
                host.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                let lastPhase = 'missing';
                let lastCanvas = 'missing';
                let lastNonBlack = 0;
                while (Date.now() < deadline) {
                  const store = window.__RH_STORE__;
                  const tabs = store && store.getState ? store.getState().tabs : [];
                  const tab = tabs.find((t) => t.kind === 'rdp');
                  lastPhase = tab ? tab.state.phase : 'missing';
                  if (lastPhase === 'error') {
                    return 'error:' + ((tab.state && tab.state.message) || 'RDP error');
                  }

                  const canvas = document.querySelector('.iron-rdp-view canvas');
                  if (canvas) {
                    lastCanvas = canvas.width + 'x' + canvas.height;
                    if (lastPhase === 'connected' && canvas.width > 0 && canvas.height > 0) {
                      try {
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                          let nonBlack = 0;
                          // Sample every fourth pixel: enough to prove a real frame without
                          // blocking the renderer on a full 1280x800 scan every iteration.
                          for (let i = 0; i < data.length; i += 16) {
                            if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) nonBlack++;
                          }
                          lastNonBlack = nonBlack;
                          if (nonBlack > 0) {
                            return 'ok:phase=connected:canvas=' + lastCanvas + ':nonBlack=' + nonBlack;
                          }
                        }
                      } catch {
                        // Canvas may be between resizes; retry until the deadline.
                      }
                    }
                  }
                  await wait(250);
                }
                return 'timeout:phase=' + lastPhase + ':canvas=' + lastCanvas + ':nonBlack=' + lastNonBlack;
              })()
            `)
    .then((res) => {
      if (typeof res === 'string' && res.startsWith('ok:phase=connected:')) {
        console.log(`[smoke] iron RDP flow OK — ${res.slice(3)}`);
        app.exit(0);
      } else {
        console.error(`[smoke] iron RDP flow failed: ${String(res)}`);
        app.exit(1);
      }
    })
    .catch((err) => {
      console.error(`[smoke] iron RDP flow rejected: ${String(err && err.message ? err.message : err)}`);
      app.exit(1);
    });
  return true;
}
