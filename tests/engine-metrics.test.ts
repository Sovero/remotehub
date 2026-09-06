import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EngineMetrics,
  localDayKey,
  extractEngineSelect,
  ENGINE_SELECT_MARKER
} from '../src/main/rdp/engine-metrics';
import { addLog, clearLogs, onLog } from '../src/main/log';

/** Тестовый хук: подменяет Date.now, чтобы корзины попадали в нужный день. */
function withFakeNow(ts: number, fn: () => void): void {
  const real = Date.now;
  Date.now = () => ts;
  try {
    fn();
  } finally {
    Date.now = real;
  }
}

describe('engine-metrics — извлечение маркера', () => {
  it('engine-select в конце строки и внутри скобок', () => {
    expect(extractEngineSelect(`RDP: выбор движка — iron (engine-select: iron)`)).toBe('iron');
    expect(extractEngineSelect(`запуск не удался (engine-select: rdpjs failed)`)).toBe('rdpjs');
    expect(extractEngineSelect(`engine-select: legacy`)).toBe('legacy');
  });

  it('чужие записи не дают ложных срабатываний', () => {
    expect(extractEngineSelect('IronRDP: мост поднят')).toBeNull();
    expect(extractEngineSelect('engine-select: без идентификатора')).toBeNull();
    expect(extractEngineSelect('engine-select: RDPEMPTY')).toBeNull();
  });

  it('маркер экспортируется для согласованности формата', () => {
    expect(ENGINE_SELECT_MARKER).toBe('engine-select:');
  });
});

describe('engine-metrics — агрегация журнала', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'remotehub-metrics-'));
    file = join(dir, 'engine-metrics.json');
    clearLogs();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('записи не-rdp и записи rdp без маркера игнорируются', () => {
    const m = new EngineMetrics(file);
    m.ingest({ id: 1, ts: Date.now(), level: 'info', source: 'iron', message: `x (engine-select: iron)` });
    m.ingest({ id: 2, ts: Date.now(), level: 'info', source: 'rdp', message: 'обычная строка RDP без маркера' });
    expect(m.snapshotFile().days).toEqual({});
  });

  it('успешные выборы движков считаются по дням', () => {
    const m = new EngineMetrics(file);
    m.ingest({ id: 1, ts: Date.now(), level: 'info', source: 'rdp', message: `RDP: движок iron (engine-select: iron)` });
    m.ingest({ id: 2, ts: Date.now(), level: 'info', source: 'rdp', message: `RDP: движок iron (engine-select: iron)` });
    m.ingest({ id: 3, ts: Date.now(), level: 'warn', source: 'rdp', message: `RDP: движок rdpjs — запуск не удался (engine-select: rdpjs failed)` });
    m.ingest({ id: 4, ts: Date.now(), level: 'info', source: 'rdp', message: `RDP: движок legacy (engine-select: legacy)` });
    const days = m.snapshotFile().days;
    const today = Object.keys(days)[0];
    expect(days[today]).toEqual({
      iron: { attempts: 2, successes: 2 },
      rdpjs: { attempts: 1, successes: 0 },
      legacy: { attempts: 1, successes: 1 }
    });
  });

  it('«failed» в маркере — неудачная попытка, в successes не попадает', () => {
    const m = new EngineMetrics(file);
    m.ingest({ id: 1, ts: Date.now(), level: 'warn', source: 'rdp', message: `не удался (engine-select: rdpjs failed)` });
    m.ingest({ id: 2, ts: Date.now(), level: 'warn', source: 'rdp', message: `не удался (engine-select: iron failed)` });
    const days = m.snapshotFile().days;
    const today = Object.keys(days)[0];
    expect(days[today]['rdpjs']).toEqual({ attempts: 1, successes: 0 });
    expect(days[today]['iron']).toEqual({ attempts: 1, successes: 0 });
  });

  it('успех и неудача различаются даже с хвостовым текстом после маркера', () => {
    const m = new EngineMetrics(file);
    m.ingest({ id: 1, ts: Date.now(), level: 'info', source: 'rdp', message: `engine-select: iron` });
    m.ingest({ id: 2, ts: Date.now(), level: 'warn', source: 'rdp', message: `engine-select: iron failed` });
    m.ingest({ id: 3, ts: Date.now(), level: 'warn', source: 'rdp', message: `engine-select: iron failed: мост не поднялся` });
    const days = m.snapshotFile().days;
    const today = Object.keys(days)[0];
    expect(days[today]['iron']).toEqual({ attempts: 3, successes: 1 });
  });

  it('корзины переживают перезапуск процесса (persist), старые дни подрезаются', () => {
    const day400 = Date.now() - 400 * 24 * 60 * 60 * 1000;
    withFakeNow(day400, () => {
      const old = new EngineMetrics(file);
      old.record('rdpjs', true);
    });
    const m2 = new EngineMetrics(file);
    m2.record('iron', true);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { days: Record<string, unknown> };
    expect(Object.keys(raw.days).length).toBe(1);
    const m3 = new EngineMetrics(file);
    const today = localDayKey(Date.now());
    expect(m3.snapshotFile().days[today]).toEqual({ iron: { attempts: 1, successes: 1 } });
  });

  it('attach: записи из потока журнала доходят до метрик', () => {
    const seen: string[] = [];
    const detach = onLog((e) => seen.push(e.message));
    const m = new EngineMetrics(file);
    m.attach();
    addLog('info', 'rdp', `RDP: выбор движка (engine-select: iron)`);
    addLog('info', 'iron', `шум (engine-select: iron)`);
    detach();
    m.dispose();
    const days = m.snapshotFile().days;
    const today = Object.keys(days)[0];
    expect(days[today]).toEqual({ iron: { attempts: 1, successes: 1 } });
  });
});

describe('engine-metrics — окно и порог решения (фаза 6)', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'remotehub-metrics-win-'));
    file = join(dir, 'engine-metrics.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('windowUsage агрегирует только дни внутри окна', () => {
    const m = new EngineMetrics(file);
    const now = Date.now();
    withFakeNow(now - 40 * 86400000, () => m.record('rdpjs', true)); // вне окна 30 дн.
    withFakeNow(now - 10 * 86400000, () => m.record('iron', true)); // внутри
    withFakeNow(now, () => {
      m.record('iron', true);
      m.record('rdpjs', true);
    });
    const win = m.windowUsage(30, now);
    expect(win.daysCovered).toBe(2);
    expect(win.byEngine['iron']).toEqual({ attempts: 2, successes: 2 });
    expect(win.byEngine['rdpjs']).toEqual({ attempts: 1, successes: 1 });
    expect(win.total.attempts).toBe(3);
  });

  it('rdpjsSharePct: 50 % при равных долях, null при пустых данных', () => {
    const m = new EngineMetrics(file);
    expect(m.rdpjsSharePct(30)).toBeNull();
    m.record('iron', true);
    expect(m.rdpjsSharePct(30)).toBe(0);
    m.record('rdpjs', true);
    expect(m.rdpjsSharePct(30)).toBeCloseTo(50, 5);
  });

  it('порог: данных меньше окна — доля считается, но вердикт «не измерим» (логика отчёта)', () => {
    // Повторяем логику скрипта: measured = daysCovered >= window && share != null.
    const m = new EngineMetrics(file);
    m.record('rdpjs', true); // 100 % rdpjs, но данных 1 день
    const win = m.windowUsage(30);
    const share = m.rdpjsSharePct(30);
    const measured = win.daysCovered >= 30 && share !== null;
    expect(share).toBe(100);
    expect(measured).toBe(false);
  });
});
