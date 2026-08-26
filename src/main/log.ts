/**
 * Журнал событий приложения (main-процесс).
 *
 * Кольцевой буфер записей: сюда пишут и main (мосты, менеджеры сессий,
 * автообновление), и renderer (через IPC log:add — переходы состояний,
 * ошибки подключения). Записи рассылаются подписчикам — ipc.ts транслирует
 * их в окна (log:entry), а окно «Лог» показывает в реальном времени.
 *
 * Уровни: info — нормальный ход, warn — подозрительное, error — сбой.
 * Источники: app, rdp, iron (IronRDP-мост), vnc, ssh, update, sftp, system.
 */
export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'app' | 'rdp' | 'iron' | 'vnc' | 'ssh' | 'telnet' | 'update' | 'sftp' | 'system';

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  source: LogSource;
  message: string;
}

/** Сколько записей держим в памяти (кольцевой буфер). */
const MAX_ENTRIES = 2000;

let seq = 0;
const entries: LogEntry[] = [];
const listeners = new Set<(e: LogEntry) => void>();

export function addLog(level: LogLevel, source: LogSource, message: string): LogEntry {
  const entry: LogEntry = { id: ++seq, ts: Date.now(), level, source, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  for (const l of listeners) l(entry);
  return entry;
}

export function getLogs(): LogEntry[] {
  return [...entries];
}

export function clearLogs(): void {
  entries.length = 0;
}

/** Подписка на новые записи. Возвращает функцию отписки. */
export function onLog(cb: (e: LogEntry) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
