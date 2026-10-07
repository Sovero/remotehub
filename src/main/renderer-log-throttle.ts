/**
 * Ограничитель потока console.* рендерера в журнал приложения.
 *
 * Зачем: src/main/index.ts перехватывает console-message рендерера, чтобы
 * стадии X.224/TLS/CredSSP/NLA WASM-клиента IronRDP были видны без devtools
 * (init('debug') в IronRdpView пишет в console подробности протокола). Но во
 * время активной сессии этот же канал приносит сотни сообщений в секунду:
 * каждое — запись в кольцевой буфер + IPC-рассылка во все окна, то есть
 * журнал сам начинает тормозить сессию. Ограничитель отделяет диагностику
 * (подключение, ошибки — их всегда показываем) от потока (шторм во время
 * картинки — его схлопываем в одну сводку).
 *
 * Правила:
 *  - error/warn — всегда немедленно;
 *  - info — подряд идущие дубликаты не показываются повторно;
 *  - info — не больше maxPerWindow записей за окно windowMs;
 *  - всё подавленное накапливается и через windowMs печатается одной
 *    строкой-сводкой (ничего не теряется молча).
 */
import type { LogLevel, LogSource } from './log';

export interface RendererLogThrottleOptions {
  /** Сколько информационных сообщений пропускать за окно. */
  maxPerWindow?: number;
  /** Длина окна, мс. */
  windowMs?: number;
}

/** Куда уходят пропущенные и сводные записи (в тестах — шим). */
export type RendererLogSink = (level: LogLevel, source: LogSource, message: string) => void;

export interface RendererLogThrottle {
  /** Обработать одно сообщение консоли рендерера (уровень уже сопоставленный). */
  offer(level: LogLevel, message: string): void;
  /** Сброс состояния (окно, дубликаты, отложенные сводки). */
  reset(): void;
}

export function createRendererLogThrottle(
  sink: RendererLogSink,
  options: RendererLogThrottleOptions = {}
): RendererLogThrottle {
  const windowMs = options.windowMs ?? 1000;
  const maxPerWindow = options.maxPerWindow ?? 20;

  let windowStart = 0;
  let windowCount = 0;
  let lastInfo = '';
  let suppressed = 0;
  let summaryTimer: ReturnType<typeof setTimeout> | null = null;

  const flushSummary = (): void => {
    summaryTimer = null;
    if (suppressed === 0) return;
    const n = suppressed;
    suppressed = 0;
    sink('info', 'app', `[renderer] частый поток консоли — подавлено ${n} сообщений (дубликаты/лимит ${maxPerWindow} в секунду)`);
  };

  const armSummary = (): void => {
    if (summaryTimer) return;
    summaryTimer = setTimeout(flushSummary, windowMs);
    summaryTimer.unref?.();
  };

  return {
    offer(level: LogLevel, message: string): void {
      if (level !== 'info') {
        // Ошибки и предупреждения важнее любых лимитов.
        sink(level, 'app', message);
        return;
      }
      const now = Date.now();
      if (now - windowStart >= windowMs) {
        windowStart = now;
        windowCount = 0;
      }
      if (message === lastInfo || windowCount >= maxPerWindow) {
        suppressed += 1;
        armSummary();
        return;
      }
      windowCount += 1;
      lastInfo = message;
      sink(level, 'app', message);
    },
    reset(): void {
      if (summaryTimer) clearTimeout(summaryTimer);
      summaryTimer = null;
      windowStart = 0;
      windowCount = 0;
      lastInfo = '';
      suppressed = 0;
    }
  };
}
