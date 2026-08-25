import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Store the mock callbacks so we can trigger events
const eventHandlers: Record<string, (...args: unknown[]) => void> = {};
let capturedBroadcast: (channel: string, payload: unknown) => void;

const mockAutoUpdater = {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  logger: null as unknown,
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    eventHandlers[event] = handler;
  }),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  removeAllListeners: vi.fn()
};

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return true; },
    getVersion: () => '0.1.7'
  },
  dialog: { showMessageBox: vi.fn() }
}));

// Dynamic import AFTER mocks are registered
const { Updater } = await import('../src/main/updater');

describe('Updater — автообновление находит 0.1.8 из 0.1.7', () => {
  let updater: InstanceType<typeof Updater>;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(eventHandlers)) delete eventHandlers[key];
    capturedBroadcast = vi.fn();
    updater = new Updater(capturedBroadcast);
  });

  afterEach(() => {
    updater.dispose();
  });

  it('checkForUpdates вызывается при проверке обновлений', async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true
    });

    await updater.check(true);

    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('push-ит "available" когда GitHub отдаёт 0.1.8', async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.1.8' }
    });

    await updater.check(true);

    // Триггерим обработчик 'update-available' как это делает electron-updater
    expect(eventHandlers['update-available']).toBeDefined();
    eventHandlers['update-available']({ version: '0.1.8' });

    expect(capturedBroadcast).toHaveBeenCalledWith(
      'update:state',
      expect.objectContaining({
        state: expect.objectContaining({ status: 'available', version: '0.1.8' })
      })
    );
  });

  it('push-ит "not-available" когда версии совпадают', async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false
    });

    await updater.check(true);

    expect(eventHandlers['update-not-available']).toBeDefined();
    eventHandlers['update-not-available']();

    expect(capturedBroadcast).toHaveBeenCalledWith(
      'update:state',
      expect.objectContaining({
        state: expect.objectContaining({ status: 'not-available' })
      })
    );
  });

  it('парсит releaseNotes (массив объектов) из GitHub', () => {
    // Тестируем приватный метод formatNotes через событие
    const notes = [
      { note: 'Добавлено: RDP COM-хост' },
      { note: 'Исправлено: CLSID MsTscAx' }
    ];

    // Триггерим событие с releaseNotes
    eventHandlers['update-available']({ version: '0.1.8', releaseNotes: notes });

    expect(capturedBroadcast).toHaveBeenCalledWith(
      'update:state',
      expect.objectContaining({
        state: expect.objectContaining({
          status: 'available',
          releaseNotes: expect.stringContaining('RDP COM-хост')
        })
      })
    );
  });

  it('парсит releaseNotes (строка) из GitHub', () => {
    eventHandlers['update-available']({ version: '0.1.8', releaseNotes: 'Все изменения' });

    expect(capturedBroadcast).toHaveBeenCalledWith(
      'update:state',
      expect.objectContaining({
        state: expect.objectContaining({
          status: 'available',
          releaseNotes: 'Все изменения'
        })
      })
    );
  });

  it('не вызывает checkForUpdates дважды параллельно', async () => {
    mockAutoUpdater.checkForUpdates.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ isUpdateAvailable: true }), 50))
    );

    await Promise.all([updater.check(true), updater.check(true)]);

    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('push-ит "error" при ошибке проверки', async () => {
    mockAutoUpdater.checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'));

    await updater.check(true);

    // Триггерим обработчик ошибки
    expect(eventHandlers['error']).toBeDefined();
    eventHandlers['error'](new Error('net::ERR_INTERNET_DISCONNECTED'));

    expect(capturedBroadcast).toHaveBeenCalledWith(
      'update:state',
      expect.objectContaining({
        state: expect.objectContaining({ status: 'error', message: expect.stringContaining('INTERNET') })
      })
    );
  });
});
