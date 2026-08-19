import { describe, expect, it } from 'vitest';
import net from 'net';
import { checkPort, parsePingError, parsePingMs, pingHost } from '../src/main/availability';

function listenOnce(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      resolve({
        port: address.port,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}

async function freePort(): Promise<number> {
  const { port, close } = await listenOnce();
  await close();
  return port;
}

describe('checkPort', () => {
  it('отвечает ok для слушающего порта', async () => {
    const { port, close } = await listenOnce();
    try {
      const res = await checkPort('127.0.0.1', port, 2000);
      expect(res.ok).toBe(true);
      expect(res.ms).toBeGreaterThanOrEqual(0);
    } finally {
      await close();
    }
  });

  it('отвечает ошибкой для закрытого порта (ECONNREFUSED)', async () => {
    const port = await freePort();
    const res = await checkPort('127.0.0.1', port, 2000);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('отвечает ошибкой по таймауту для недоступного адреса', async () => {
    // 203.0.113.1 — TEST-NET-3, гарантированно не маршрутизируется: соединение зависает → таймаут
    const res = await checkPort('203.0.113.1', 81, 300);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('таймаут');
  });
});

describe('pingHost', () => {
  it('отвечает ok для 127.0.0.1 (реальный шов через системный ping)', async () => {
    const res = await pingHost('127.0.0.1', 2000);
    expect(res.ok).toBe(true);
    expect(res.ms).toBeGreaterThanOrEqual(0);
  });
});

describe('parsePingMs', () => {
  it('читает время из русского и английского вывода', () => {
    expect(parsePingMs('Ответ от 127.0.0.1: число байт=32 время=4мс TTL=128')).toBe(4);
    expect(parsePingMs('Reply from 127.0.0.1: bytes=32 time=4ms TTL=128')).toBe(4);
  });

  it('читает time<1ms как 1 мс', () => {
    expect(parsePingMs('Reply from 127.0.0.1: bytes=32 time<1ms TTL=128')).toBe(1);
  });

  it('возвращает null, если времени в выводе нет', () => {
    expect(parsePingMs('PING 127.0.0.1 (127.0.0.1): 56 data bytes')).toBeNull();
  });
});

describe('parsePingError', () => {
  it('распознаёт таймаут, недоступность и DNS', () => {
    expect(parsePingError('Превышен интервал ожидания для запроса.')).toContain('таймаут');
    expect(parsePingError('Request timed out.')).toContain('таймаут');
    expect(parsePingError('Сведения: 192.168.1.254 - Не удается связаться с узлом назначения.')).toContain(
      'недоступен'
    );
    expect(parsePingError('Не удается найти узел no-such-host.local.')).toContain('не разрешается');
  });

  it('даёт общий ответ для незнакомого вывода', () => {
    expect(parsePingError('что-то пошло не так')).toBe('нет ответа на ping');
  });
});
