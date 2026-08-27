import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { addLog, clearLogs, getLogs, onLog } from '../src/main/log';

afterEach(() => {
  clearLogs();
});

describe('log module', () => {
  it('накапливает записи и возвращает их в порядке добавления', () => {
    addLog('info', 'iron', 'мост поднят');
    addLog('error', 'iron', 'таймаут');
    const logs = getLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].level).toBe('info');
    expect(logs[0].source).toBe('iron');
    expect(logs[0].message).toBe('мост поднят');
    expect(logs[1].level).toBe('error');
    expect(logs[1].id).toBeGreaterThan(logs[0].id);
  });

  it('рассылает новые записи подписчикам, отписка работает', () => {
    const cb = vi.fn();
    const off = onLog(cb);
    addLog('warn', 'vnc', 'рукопожатие не удалось');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].message).toBe('рукопожатие не удалось');
    off();
    addLog('info', 'app', 'тишина');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('clearLogs очищает буфер', () => {
    addLog('info', 'app', 'x');
    clearLogs();
    expect(getLogs()).toHaveLength(0);
  });

  it('кольцевой буфер не превышает лимит', () => {
    for (let i = 0; i < 2100; i++) addLog('info', 'app', `запись ${i}`);
    const logs = getLogs();
    expect(logs).toHaveLength(2000);
    expect(logs[0].message).toBe('запись 100');
    expect(logs[logs.length - 1].message).toBe('запись 2099');
  });
});

// ---- IPC logs:export (dialog.showSaveDialog замокан по образцу tests/updater.test.ts) ----

const ipcHandlers: Record<string, (...args: unknown[]) => unknown> = {};
const mockShowSaveDialog = vi.fn();

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.14',
    getPath: () => tmpdir()
  },
  dialog: {
    showSaveDialog: mockShowSaveDialog,
    showOpenDialog: vi.fn()
  },
  BrowserWindow: {
    fromWebContents: () => null,
    getAllWindows: () => []
  },
  ipcMain: {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      ipcHandlers[channel] = listener;
    }),
    on: vi.fn()
  }
}));

// registerIpc тянет за собой Updater → electron-updater; мокаем, чтобы не трогать реальный автоапдейтер.
vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    removeAllListeners: vi.fn()
  }
}));

// Динамический импорт после регистрации моков (см. tests/updater.test.ts).
const { registerIpc } = await import('../src/main/ipc');
const { IPC } = await import('../src/shared/ipc-contract');

describe('IPC logs:export', () => {
  beforeAll(() => {
    // Store/менеджеры не используются обработчиком logs:export — заглушки безопасны:
    // registerIpc только регистрирует лямбды в ipcMain.handle, ничего не вызывает сразу.
    registerIpc(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
  });

  const invokeExport = (text: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> => {
    const handler = ipcHandlers[IPC.logsExport] as (e: unknown, req: { text: string }) => Promise<{
      ok: boolean;
      path?: string;
      canceled?: boolean;
      error?: string;
    }>;
    return handler({ sender: {} }, { text });
  };

  afterEach(() => {
    mockShowSaveDialog.mockReset();
  });

  it('сохраняет отфильтрованный текст журнала в выбранный файл', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rh-log-export-'));
    const filePath = join(dir, 'log.txt');
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });

    const res = await invokeExport('[00:00:00.000] [INFO] [app] тест-строка');

    expect(res.ok).toBe(true);
    expect(res.path).toBe(filePath);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe('[00:00:00.000] [INFO] [app] тест-строка');
  });

  it('отмена диалога сохранения — ok:false, canceled:true, без текста ошибки', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: true });

    const res = await invokeExport('что угодно');

    expect(res).toEqual({ ok: false, canceled: true });
  });

  it('сбой записи файла — ok:false с понятным текстом ошибки', async () => {
    // Каталог заведомо не существует — writeFileSync бросит ENOENT.
    const filePath = join(tmpdir(), 'rh-log-export-missing-dir-xyz', 'log.txt');
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });

    const res = await invokeExport('текст журнала');

    expect(res.ok).toBe(false);
    expect(res.canceled).toBeUndefined();
    expect(res.error).toBeTruthy();
  });
});
