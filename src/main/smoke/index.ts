import { app, type BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Store } from '../store';
import { runCaptureHelpFlow } from './capture-help';
import { runRdpIronFlow } from './rdp-flows';
import { runVncFlow, runVncErrorFlow, runSftpFlow, runSftpTunnelsFlow } from './vnc-sftp';
import { runIconsFlow } from './ui-icons';
import { runUpdateFlow, runContrastFlow } from './ui-update-contrast';
import { runScreenshotFlow } from './ui-screenshot';
import {
  runCredFlow,
  runSnipsFlow,
  runAvailFlow,
  runThemeFlow,
  runHelpFlow,
  runAutoHelpFlow,
  runExpectTabsFlow,
  runSessionFlow
} from './ui-flows';

/**
 * Устанавливает opt-in smoke-хуки на mainWindow: срабатывают только когда
 * запущено под RH_SMOKE=1 (плюс конкретный флаг сценария, см. scripts/*.mjs).
 * В обычном запуске приложения не делает ничего.
 *
 * Перенесено дословно из src/main/index.ts — каждая ветка RH_SMOKE_...
 * и RH_CAPTURE_HELP вынесена в отдельный модуль под src/main/smoke/ без
 * изменения тестовой логики.
 */
export function installSmokeHooks(mainWindow: BrowserWindow, store: Store): void {
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
        if (await runCaptureHelpFlow(mainWindow, watchdog)) return;

        if (expected !== (hostRows as number)) {
          console.error(`[smoke] expected ${expected} host rows, got ${String(hostRows)}`);
          app.exit(1);
          return;
        }
        if (await runScreenshotFlow(mainWindow)) return;
        if (await runVncFlow(mainWindow, watchdog)) return;
        // Ошибка рукопожатия VNC: сервер молчит → вкладка показывает понятный оверлей.
        if (await runVncErrorFlow(mainWindow, watchdog)) return;
        // Иконки в кнопках: после добавления Icon-компонента кнопки не должны
        // терять содержимое, а svg — рендериться с ненулевым размером.
        if (await runIconsFlow(mainWindow, watchdog)) return;
        // Автообновление: баннер UpdateBar отображает все состояния,
        // release notes раскрываются, а «Проверить обновления» в «О программе»
        // вызывает checkUpdates из стора.
        if (await runUpdateFlow(mainWindow, watchdog)) return;
        // Контраст иконок и кнопок-иконок: обе темы × все акцентные цвета.
        if (await runContrastFlow(mainWindow, watchdog)) return;
        // SFTP: реальный список каталога через fake-сервер — иконки файла/папки,
        // передача с иконкой направления и завершение с галочкой.
        if (await runSftpFlow(mainWindow, watchdog)) return;
        if (await runRdpIronFlow(mainWindow, watchdog)) return;
        if (await runCredFlow(mainWindow, watchdog)) return;
        if (await runSnipsFlow(mainWindow, watchdog)) return;
        // Сценарий «Проверить доступность»: контекстное меню хоста → тултип с результатом.
        if (await runAvailFlow(mainWindow, watchdog)) return;
        // Сценарий темы/акцента: настройки из сайдбара → светлая тема → акцент.
        if (await runThemeFlow(mainWindow, watchdog)) return;
        // Сценарий справки: меню → диалог с оглавлением.
        if (await runHelpFlow(mainWindow, watchdog)) return;
        // Авто-открытие раздела «Неполадки» при первой ошибке подключения.
        if (await runAutoHelpFlow(mainWindow, watchdog)) return;
        if (await runExpectTabsFlow(mainWindow, watchdog)) return;
        // Сценарий сессии: двойной клик по первому хосту, ждём оверлей ошибки.
        if (await runSessionFlow(mainWindow, watchdog)) return;
        // Сценарий SFTP/туннелей: SSH-вкладка → диалог туннелей → SFTP-панель
        // через контекстное меню (порт мёртвый, проверяем путь до ошибки UI).
        if (await runSftpTunnelsFlow(mainWindow, watchdog)) return;
        clearTimeout(watchdog);
        app.exit(0);
      };
      void check();
    });
  }
}
