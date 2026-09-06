/**
 * Локальные метрики выбора RDP-движка — фаза 2 плана вывода rdpjs из
 * эксплуатации (docs/rdpjs-deprecation-plan.md §4).
 *
 * Источник данных — журнал событий (src/main/log.ts): хаб на каждую попытку
 * запуска RDP-сессии пишет в source 'rdp' строку с маркером
 * `engine-select: <движок>` (успех) или `engine-select: <движок> failed`
 * (неудача) — см. onConnectResult в index.ts. Этот модуль подписан на поток
 * записей (onLog), выделяет маркер и агрегирует выбор движка ПО ДНЯМ локальной
 * даты. Только счётчики: ни host, ни логин, ни содержимое сессий сюда не
 * попадают и наружу не отправляются (без телеметрии).
 *
 * Зачем свой файл, а не кольцевой буфер журнала: буфер держит 2000 последних
 * записей в памяти и умирает вместе с процессом, а критерий удаления rdpjs —
 * «≤ 5 % RDP-сессий за ≥ 30 дней» (метрика решения, §4). Корзины хранятся в
 * userData (engine-metrics.json, атомарная запись — как у всех файлов userData)
 * и накапливаются между запусками приложения.
 *
 * Вердикт порога печатает scripts/engine-metrics-report.mjs (read-only).
 */
import { onLog, type LogEntry } from '../log';
import { atomicWriteJson, readJsonSafe } from '../store/atomic';

const SCHEMA_VERSION = 1;

/** Маркер в тексте записи журнала, по которому выделяется выбор движка. */
export const ENGINE_SELECT_MARKER = 'engine-select:';

/** Храним корзины за последние 180 дней — после порога решения (30 дней) запас уже не нужен. */
export const RETENTION_DAYS = 180;

export interface EngineDayCounters {
  attempts: number;
  successes: number;
}

export interface EngineMetricsFile {
  schemaVersion: number;
  /** Ключ — локальная дата YYYY-MM-DD, значение — счётчики по движкам. */
  days: Record<string, Record<string, EngineDayCounters>>;
}

export interface EngineUsageWindow {
  since: string;
  until: string;
  /** Сколько дней с данными попало в окно (данные сессий за день без запусков не появляются). */
  daysCovered: number;
  total: EngineDayCounters;
  byEngine: Record<string, EngineDayCounters>;
}

/** Локальная дата YYYY-MM-DD для timestamp. */
export function localDayKey(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Локальная дата, смещённая от базовой на deltaDays дней. */
function localDayShift(base: string, deltaDays: number): string {
  const [y, m, d] = base.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return localDayKey(dt.getTime());
}

/** Убрать корзины старше retention дней (включая сегодня). */
function pruneDays(days: Record<string, Record<string, EngineDayCounters>>, retention: number) {
  const cutoff = localDayShift(localDayKey(Date.now()), -(retention - 1));
  const out: Record<string, Record<string, EngineDayCounters>> = {};
  for (const [key, counters] of Object.entries(days)) {
    if (key >= cutoff) out[key] = counters;
  }
  return out;
}

/**
 * Достать из текста записи выбор движка: «…engine-select: rdpjs» → 'rdpjs'.
 * Вне маркера движков не знает — null. Движок-идентификатор: строчные буквы,
 * цифры, дефис.
 */
export function extractEngineSelect(message: string): string | null {
  const idx = message.indexOf(ENGINE_SELECT_MARKER);
  if (idx < 0) return null;
  const rest = message.slice(idx + ENGINE_SELECT_MARKER.length).trim();
  const m = /^([a-z][a-z0-9-]*)/.exec(rest);
  return m ? m[1] : null;
}

export class EngineMetrics {
  private file: EngineMetricsFile;
  private detachLog: (() => void) | null = null;

  /**
   * Путь передаётся явно (внедряемая зависимость) — юнит-тесты подставляют
   * временный файл вместо реального userData (паттерн HostKeyStore).
   */
  constructor(private readonly filePath: string) {
    const res = readJsonSafe<EngineMetricsFile>(filePath);
    this.file = {
      schemaVersion: res.data?.schemaVersion ?? SCHEMA_VERSION,
      days: pruneDays(res.data?.days ?? {}, RETENTION_DAYS)
    };
  }

  /** Подписка на поток журнала. Идемпотентно. */
  attach(): void {
    if (this.detachLog) return;
    this.detachLog = onLog((entry) => this.ingest(entry));
  }

  /** Отписка (тесты, корректное завершение). */
  dispose(): void {
    this.detachLog?.();
    this.detachLog = null;
  }

  /**
   * Обработать запись журнала. Считаются ТОЛЬКО записи source 'rdp' с маркером
   * engine-select; «failed» в хвосте маркера — неудачная попытка запуска
   * (сессией не стала и в долю успешных движков не попадает). Хвост после
   * идентификатора движка не обязан быть пустым — маркер живёт внутри скобок
   * в конце строки, поэтому ищем слово «failed», а не сравниваем остаток целиком.
   */
  ingest(entry: LogEntry): void {
    if (entry.source !== 'rdp') return;
    const engine = extractEngineSelect(entry.message);
    if (!engine) return;
    const idx = entry.message.indexOf(ENGINE_SELECT_MARKER) + ENGINE_SELECT_MARKER.length;
    const rest = entry.message.slice(idx).trim();
    const failed = /\bfailed\b/.test(rest);
    this.record(engine, !failed);
  }

  /**
   * Инкремент корзины текущего локального дня с немедленной записью на диск:
   * попыток запуска RDP в день единицы-десятки, цена записи ничтожна,
   * зато счётчики переживают сбой питания.
   */
  record(engine: string, ok: boolean): void {
    const key = localDayKey(Date.now());
    let counters = this.file.days[key];
    if (!counters) {
      counters = {};
      this.file.days[key] = counters;
    }
    const cur = counters[engine] ?? { attempts: 0, successes: 0 };
    cur.attempts += 1;
    if (ok) cur.successes += 1;
    counters[engine] = cur;
    atomicWriteJson(this.filePath, this.file);
  }

  /** Сводка за окно из windowDays дней, заканчивающихся днём now (по умолчанию сегодня). */
  windowUsage(windowDays: number, now: number = Date.now()): EngineUsageWindow {
    const until = localDayKey(now);
    const since = localDayShift(until, -(windowDays - 1));
    const win: EngineUsageWindow = {
      since,
      until,
      daysCovered: 0,
      total: { attempts: 0, successes: 0 },
      byEngine: {}
    };
    for (const [key, counters] of Object.entries(this.file.days)) {
      if (key < since || key > until) continue;
      win.daysCovered += 1;
      for (const [engine, c] of Object.entries(counters)) {
        let agg = win.byEngine[engine];
        if (!agg) {
          agg = { attempts: 0, successes: 0 };
          win.byEngine[engine] = agg;
        }
        agg.attempts += c.attempts;
        agg.successes += c.successes;
        win.total.attempts += c.attempts;
        win.total.successes += c.successes;
      }
    }
    return win;
  }

  /**
   * Метрика решения фазы 6: доля успешных rdpjs-сессий среди всех успешных
   * RDP-сессий за окно, в процентах. null — данных ещё нет (ни одной успешной
   * сессии за окно) — порог пока не измерим, удалять рано. Ноль rdpjs-запусков
   * при наличии успешных сессий на других движках — это честные 0 %, самый
   * сильный сигнал «движком не пользуются», а не «нет данных».
   */
  rdpjsSharePct(windowDays: number, now: number = Date.now()): number | null {
    const win = this.windowUsage(windowDays, now);
    if (win.total.successes === 0) return null;
    const rdpjsSuccesses = win.byEngine['rdpjs']?.successes ?? 0;
    return (rdpjsSuccesses / win.total.successes) * 100;
  }

  /** Копия хранимого файла (тесты, диагностика). */
  snapshotFile(): EngineMetricsFile {
    return JSON.parse(JSON.stringify(this.file)) as EngineMetricsFile;
  }
}
