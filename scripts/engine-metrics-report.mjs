#!/usr/bin/env node
/**
 * Отчёт по локальным метрикам выбора RDP-движка — фаза 2 плана вывода rdpjs
 * из эксплуатации (docs/rdpjs-deprecation-plan.md §4).
 *
 * Читает engine-metrics.json из userData приложения (только чтение) и печатает
 * вердикт по метрике решения фазы 6: «удалить rdpjs, если за 30 дней ≤ 5 %
 * RDP-сессий локально». До накопления ≥ 30 дней данных порог не измерим —
 * скрипт это честно показывает вместо выдуманного вердикта.
 *
 * Использование:
 *   node scripts/engine-metrics-report.mjs [--window 30] [--file <path>] [--json]
 *
 * Флаги:
 *   --window N   окно решения в днях (по умолчанию 30 — порог из плана)
 *   --file PATH  путь к engine-metrics.json (по умолчанию userData приложения)
 *   --json       машинный вывод (JSON) вместо текста
 *
 * Никогда ничего не пишет: файл метрик меняет только запущенное приложение
 * (src/main/rdp/engine-metrics.ts).
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const windowDays = Math.max(1, Number(flag('--window') ?? 30) || 30);
const asJson = hasFlag('--json');

// userData зависит от имени приложения (Electron берёт productName верхнего
// уровня package.json, иначе name) — пробуем оба варианта.
const userDataCandidates = [
  join(homedir(), 'AppData', 'Roaming', 'Remote Hub'),
  join(homedir(), 'AppData', 'Roaming', 'remote-hub')
];
const explicitFile = flag('--file');
let file = explicitFile ? resolve(explicitFile) : null;
if (!file) {
  const hit = userDataCandidates.map((dir) => join(dir, 'engine-metrics.json')).find((p) => existsSync(p));
  file = hit ?? join(userDataCandidates[0], 'engine-metrics.json');
}

// Порог метрики решения из docs/rdpjs-deprecation-plan.md §4.
const SHARE_THRESHOLD_PCT = 5;

function fail(msg) {
  if (asJson) {
    console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  } else {
    console.error(`engine-metrics-report: ${msg}`);
  }
  process.exit(1);
}

if (!existsSync(file)) {
  fail(
    `файл метрик не найден: ${file}. Он появляется после первых RDP-запусков в приложении (0.1.33+).`
  );
}

let raw;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  fail(`не удалось прочитать ${file}: ${e.message}`);
}
if (raw?.schemaVersion !== 1 || typeof raw.days !== 'object') {
  fail(`неизвестная схема ${file} — ожидается schemaVersion 1 с полем days`);
}

// --- агрегация за окно (та же логика, что EngineMetrics.windowUsage) ---
const now = new Date();
const dayKey = (d) => {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};
const until = dayKey(now);
const untilDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const sinceDate = new Date(untilDate);
sinceDate.setDate(sinceDate.getDate() - (windowDays - 1));
const since = dayKey(sinceDate);

const win = { since, until, daysCovered: 0, total: { attempts: 0, successes: 0 }, byEngine: {} };
for (const [key, counters] of Object.entries(raw.days)) {
  if (key < since || key > until) continue;
  win.daysCovered += 1;
  for (const [engine, c] of Object.entries(counters)) {
    const agg = (win.byEngine[engine] ??= { attempts: 0, successes: 0 });
    agg.attempts += c.attempts;
    agg.successes += c.successes;
    win.total.attempts += c.attempts;
    win.total.successes += c.successes;
  }
}

const rdpjs = win.byEngine.rdpjs ?? { attempts: 0, successes: 0 };
const sharePct =
  win.total.successes === 0 ? null : (rdpjs.successes / win.total.successes) * 100;
const measured = win.daysCovered >= windowDays && sharePct !== null;
const withinThreshold = measured && sharePct <= SHARE_THRESHOLD_PCT;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        file,
        windowDays,
        window: { since, until, daysCovered: win.daysCovered },
        total: win.total,
        byEngine: win.byEngine,
        rdpjsSharePct: sharePct,
        thresholdPct: SHARE_THRESHOLD_PCT,
        verdict: measured
          ? withinThreshold
            ? 'remove-ok'
            : 'keep'
          : 'not-measurable-yet'
      },
      null,
      2
    )
  );
  process.exit(0);
}

const fmt = (c) => `${c.successes}/${c.attempts}`;
console.log(`Файл метрик: ${file}`);
console.log(`Окно: ${since} … ${until} (запрошено ${windowDays} дн., с данными ${win.daysCovered} дн.)`);
console.log(`Попыток запуска RDP-сессий: ${win.total.attempts} (успешных ${win.total.successes})`);
for (const engine of Object.keys(win.byEngine).sort()) {
  console.log(`  ${engine.padEnd(8)} успех/попытка: ${fmt(win.byEngine[engine])}`);
}
console.log('');
if (sharePct === null) {
  console.log('Вердикт: порог пока НЕ измерим — нет ни одной успешной RDP-сессии за окно.');
  console.log('Метрика решения (фаза 6): доля rdpjs ≤ 5 % за 30 дней.');
} else {
  console.log(`Доля rdpjs среди успешных RDP-сессий: ${sharePct.toFixed(2)} %`);
  console.log(`Порог метрики решения: ≤ ${SHARE_THRESHOLD_PCT} % за ${windowDays} дн.`);
  if (win.daysCovered < windowDays) {
    console.log(
      `Вердикт: данных меньше ${windowDays} дн. (${win.daysCovered}) — порог официально не измерим; текущее значение (${sharePct.toFixed(2)} %) — ориентир.`
    );
  } else if (withinThreshold) {
    console.log('Вердикт: порог пройден — rdpjs можно удалять (при отсутствии обоснованных багрепортов, §4).');
  } else {
    console.log('Вердикт: порог НЕ пройден — удаление сдвигается, нужна переоценка (§4).');
  }
}
