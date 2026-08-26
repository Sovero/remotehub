import { afterEach, describe, expect, it, vi } from 'vitest';
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
