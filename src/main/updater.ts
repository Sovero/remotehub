import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC, type UpdateStatus } from '../shared/ipc-contract';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 часа
const INITIAL_DELAY_MS = 8 * 1000; // после старта приложения

/**
 * Автообновление через electron-updater (GitHub Releases).
 *
 * Обновление скачивается автоматически при обнаружении, а установка происходит
 * после явного подтверждения пользователя (кнопка «Перезапустить») или при
 * выходе из приложения.
 *
 * Проверка подписи инсталлятора (build.win.verifyUpdateCodeSignature) отключена:
 * пока сборка не подписана реальным сертификатом, electron-updater должен
 * принимать неподписанные обновления. После подключения PFX с CN `Remote Hub`
 * верните `verifyUpdateCodeSignature: true` — тогда подписанное сторонним
 * издателем обновление будет отклоняться.
 */
export class Updater {
  private started = false;
  private checking = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly broadcast: (channel: string, payload: unknown) => void;

  constructor(broadcast: (channel: string, payload: unknown) => void) {
    this.broadcast = broadcast;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = console;

    autoUpdater.on('checking-for-update', () => {
      this.push({ status: 'checking' });
    });
    autoUpdater.on('update-available', (info) => {
      this.push({ status: 'available', version: info.version, releaseNotes: this.formatNotes(info.releaseNotes) });
    });
    autoUpdater.on('update-not-available', () => {
      this.push({ status: 'not-available' });
    });
    autoUpdater.on('download-progress', (progress) => {
      this.push({
        status: 'downloading',
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.push({ status: 'downloaded', version: info.version });
    });
    autoUpdater.on('error', (err) => {
      console.error('[updater]', err);
      // ENOENT app-update.yml — файл не создаётся при --dir/unpacked-сборке.
      // Не показываем баннер — это не ошибка пользователя, а среда разработки.
      const msg = (err as Error).message ?? '';
      if (msg.includes('ENOENT') && msg.includes('app-update.yml')) {
        console.info('[updater] app-update.yml отсутствует — автообновление отключено в этой сборке');
        // Баннер не должен зависать на «Проверка обновлений…» навсегда —
        // тихо считаем это «обновлений нет» (баннер скрывается сам).
        this.push({ status: 'not-available' });
        return;
      }
      this.push({ status: 'error', message: msg });
    });
  }

  private push(state: UpdateStatus): void {
    this.broadcast(IPC.updateState, { state });
  }

  /** Запускает фоновую проверку (только в установленной сборке). */
  start(): void {
    if (this.started) return;
    this.started = true;

    if (!app.isPackaged) {
      console.info('[updater] автообновление отключено в dev-режиме');
      return;
    }

    setTimeout(() => void this.check(false), INITIAL_DELAY_MS);
    this.timer = setInterval(() => void this.check(false), CHECK_INTERVAL_MS);
  }

  /** Проверка наличия обновления. manual — запущена пользователем из меню. */
  async check(manual: boolean): Promise<void> {
    if (this.checking) return;
    if (!app.isPackaged) {
      if (manual) {
        await dialog.showMessageBox({
          type: 'info',
          title: 'Обновления',
          message: 'Автообновление недоступно в dev-режиме',
          detail: 'Запустите установленную сборку (инсталлятор из release/), чтобы проверять обновления.'
        });
      }
      return;
    }

    this.checking = true;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (manual && !result?.isUpdateAvailable) {
        await dialog.showMessageBox({
          type: 'info',
          title: 'Обновления',
          message: 'Обновлений нет',
          detail: `У вас установлена последняя версия ${app.getVersion()}.`
        });
      }
    } catch (err) {
      console.error('[updater] check failed:', err);
      if (manual) {
        await dialog.showMessageBox({
          type: 'warning',
          title: 'Обновления',
          message: 'Не удалось проверить обновления',
          detail: (err as Error).message
        });
      }
    } finally {
      this.checking = false;
    }
  }

  /** Скачивает уже найденное обновление вручную (на случай autoDownload=false). */
  async download(): Promise<void> {
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      console.error('[updater] download failed:', err);
      this.push({ status: 'error', message: (err as Error).message });
    }
  }

  /** Перезапускает приложение и устанавливает скачанное обновление. */
  quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    autoUpdater.removeAllListeners();
  }

  private formatNotes(notes?: string | Array<{ note: string | null }> | null): string | undefined {
    if (!notes) return undefined;
    if (typeof notes === 'string') return notes;
    const lines = notes.map((n) => n.note).filter((n): n is string => typeof n === 'string');
    return lines.length > 0 ? lines.join('\n') : undefined;
  }
}
