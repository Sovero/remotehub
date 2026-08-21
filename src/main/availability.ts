import { spawn } from 'child_process';
import net from 'net';
import type { CheckResult } from '../shared/ipc-contract';

/** Таймаут одной проверки (TCP или ping), мс. */
export const CHECK_TIMEOUT_MS = 2500;

/**
 * Проверка TCP-порта: установка соединения с таймаутом.
 * Не требует прав и работает для любого протокола.
 */
export function checkPort(
  host: string,
  port: number,
  timeoutMs = CHECK_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<CheckResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, canceled: true });
      return;
    }
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (res: CheckResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      resolve(res);
    };
    const onAbort = (): void => done({ ok: false, canceled: true });
    signal?.addEventListener('abort', onAbort);
    // Реальный дедлайн: ограничивает и саму попытку установки соединения,
    // а не только бездействие после подключения.
    timer = setTimeout(() => done({ ok: false, error: `таймаут: нет ответа за ${timeoutMs} мс` }), timeoutMs);
    socket.once('connect', () => done({ ok: true, ms: Date.now() - started }));
    socket.once('error', (err: NodeJS.ErrnoException) => {
      done({ ok: false, error: err.code === 'ECONNREFUSED' ? 'соединение отклонено' : (err.code ?? err.message) });
    });
    try {
      socket.connect(port, host);
    } catch (err) {
      done({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** Время ответа ping: «время=4мс» / «time=4ms» / «time<1ms». */
export function parsePingMs(output: string): number | null {
  const m = /(?:время|time)\s*[=<]\s*(\d+)/i.exec(output);
  return m ? Number(m[1]) : null;
}

/** Причина недоступности ping по выводу утилиты. */
export function parsePingError(output: string): string {
  if (/превышен интервал ожидания|timed out|timeout/i.test(output)) return 'нет ответа (таймаут)';
  if (/не удается связаться|unreachable|destination host/i.test(output)) return 'хост недоступен';
  if (/не удается найти|не удаётся найти|не найдена|не найден|cannot resolve|not known|not found/i.test(output))
    return 'имя не разрешается';
  return 'нет ответа на ping';
}

/**
 * ICMP ping через системную утилиту `ping` (без внешних зависимостей).
 * Windows: `ping -n 1 -w <мс> host`; Unix: `ping -c 1 -W <сек> host`.
 */
export function pingHost(host: string, timeoutMs = CHECK_TIMEOUT_MS, signal?: AbortSignal): Promise<CheckResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, canceled: true });
      return;
    }
    const win = process.platform === 'win32';
    const args = win
      ? ['-n', '1', '-w', String(timeoutMs), host]
      : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host];
    const started = Date.now();
    let out = '';
    let settled = false;
    const child = spawn('ping', args, { windowsHide: true });
    const finish = (res: CheckResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      child.kill();
      resolve(res);
    };
    const onAbort = (): void => finish({ ok: false, canceled: true });
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => finish({ ok: false, error: 'нет ответа (таймаут)' }), timeoutMs + 1500);
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.on('error', (err: Error) => finish({ ok: false, error: `ping недоступен: ${err.message}` }));
    child.on('close', (code) => {
      if (code !== 0) {
        finish({ ok: false, error: parsePingError(out) });
        return;
      }
      const ms = parsePingMs(out);
      finish({ ok: true, ms: ms ?? Date.now() - started });
    });
  });
}
