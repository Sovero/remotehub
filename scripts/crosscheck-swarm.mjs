/**
 * Живой кросс-чек docs/rdp-engine-risk-report.md роем claude-flow
 * (координационная оболочка — swarm-mtmi05ru, pattern 1 из docs/swarm-patterns.md).
 *
 * Что делает:
 *  1. Проверяет аутентификацию `claude` CLI (без логина — exit 2 с подсказкой).
 *  2. Порождает 4 headless-агента (`claude -p`): по исследователю на движок
 *     (iron / rdpjs / comhost) + аналитик сквозных рисков (R6, тесты).
 *     Инструменты ограничены чтением кода; исходники менять запрещено —
 *     харнесс в конце сверяет `git status` по src/ и tests/.
 *  3. Собирает вердикты в .claude-flow/research/crosscheck/crosscheck-*.md
 *     и печатает сводку разногласий с R1–R8.
 *
 * Запуск: node scripts/crosscheck-swarm.mjs
 * Требует: claude /login (или ANTHROPIC_API_KEY + --bare-режим вручную).
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, '.claude-flow', 'research', 'crosscheck');
const REPORT = 'docs/rdp-engine-risk-report.md';

const AGENTS = [
  {
    id: 'iron',
    claims: [
      'R3: самописный DER-кодек RDCleanPath в src/main/rdp/iron-gateway.ts (encodeRequest/encodeResponse/encodeError/readTlv), версия 3390 зашита константой RDCLEANPATH_VERSION',
      'R4: мост забирает цепочку сертификатов сервера ОТДЕЛЬНЫМ «пробным» TCP-соединением (probeCertificates) — при балансировке фермы можно провалидировать сертификат одного узла, а туннель уйти к другому',
      'R8 (уже исправлено в 0.1.30): ws-мост на 127.0.0.1 теперь принимает подключения только с одноразовым токеном сессии (upgrade ?token= + proxy_auth Request PDU, timing-safe сравнение) — проверь актуальную реализацию и оцени, остались ли дыры (например, повторное использование токена после reconnect)'
    ],
    files: 'src/main/rdp/iron-gateway.ts, src/main/rdp/iron-sessions.ts, tests/iron-gateway.test.ts, tests/iron-probe.test.ts, src/renderer/src/components/IronRdpView.tsx'
  },
  {
    id: 'rdpjs',
    claims: [
      'R1: node-rdpjs-2 0.3.5 не поддерживается, весь RDP-стек (X.224/MCS/SEC, RLE-распаковка) исполняется в main-процессе Electron; у клиента нет таймаутов соединения (Promise может не завершиться при молчащем сервере)',
      'R5: битмапы идут через IPC rdpjs:bitmap по одному сообщению на прямоугольник (BGRA), полная копия буфера на кадр в src/main/index.ts; rAF-батчинг в RdpCanvas.tsx сливает очередь в один блит',
      'R7 (исправлено в 0.1.30): deprecated Buffer.prototype.slice заменён на Buffer.from(view) — точная копия диапазона; проверь, что инвариант «не сериализовать весь backing buffer» действительно покрыт тестом tests/quick-fixes.test.ts'
    ],
    files: 'src/main/rdp/rdpjs-client.ts, src/renderer/src/components/RdpCanvas.tsx, src/main/index.ts (broadcast rdpjs:bitmap), tests/rdpjs-client.test.ts, package.json (node-rdpjs-2 ^0.3.5)'
  },
  {
    id: 'comhost',
    claims: [
      'R2: пароль ОС пишется в Credential Manager через cmdkey /generic:TERMSRV/<host> (src/main/rdp/com-launcher.ts); пароль дублируется в stdin дочернего процесса (не в argv); в 0.1.30 добавлена аварийная уборка purgeCmdkeyCredential в RdpManager.closeAll() — проверь, все ли пути выхода покрывает (крах main-процесса? kill -9?)',
      'Окно COM-хоста — owned (не WS_CHILD) из-за DirectComposition Chromium; координаты DIP↔физические пиксели конвертируются в ipc.ts и src/main/index.ts (getParentOrigin) — оцени риск рассинхронизации при смене масштаба/монитора',
      'Проверь утверждение отчёта, что этот движок единственный подключается к серверам с классическими RSA-сертификатами (SChannel в mstscax.dll против rustls IronRDP)'
    ],
    files: 'src/main/rdp/com-launcher.ts, src/main/rdp/manager.ts, src/main/rdp/embed.ts, tests/quick-fixes.test.ts (R2-секция), docs/rdp-engine-risk-report.md §3.3'
  },
  {
    id: 'analyst',
    claims: [
      'R6: три движка имеют три несимметричных жизненных цикла сессии (iron — renderer/WASM, rdpjs — карта RdpjsClientManager без сторожа, legacy — RdpManager со сторожем/kill-grace/debounce); точки унификации: единый интерфейс движков, двойной ввод координат (RdpCanvas vs LegacyRdpView), секреты в renderer vs main',
      'Каркас RdpEngineHub уже написан (src/main/rdp/engine-hub.ts, src/shared/rdp-engine.ts), но НЕ подключён к ipc.ts/index.ts; sessionClose в src/main/ipc.ts до сих пор рвёт все три движка на каждую сессию (rdpjs.disconnect + stopIronGateway + rdpLegacy.stop) — проверь и оцени план подключения из docs/rdpjs-deprecation-plan.md фазы 1',
      'Проверь утверждения §5 отчёта о пробелах в тестах: нет replay-интеграционного теста с фейковым RDP-сервером для iron/rdpjs, нет теста на cleanup cmdkey при аварийном завершении, нет e2e на координатную арифметику embed'
    ],
    files: 'src/main/rdp/engine-hub.ts, src/shared/rdp-engine.ts, src/main/ipc.ts (sessionClose, rdpjs*, rdpLegacy*), src/renderer/src/store.ts (openRdp/reconnect), tests/ (полный список), docs/rdpjs-deprecation-plan.md'
  }
];

function fail(msg, code = 1) {
  console.error(`[crosscheck] ${msg}`);
  process.exit(code);
}

/** Проверка аутентификации: дешёвый вызов haiku. */
function checkAuth() {
  console.log('[crosscheck] проверка аутентификации claude CLI…');
  let out = '';
  try {
    out = execFileSync('claude', ['-p', 'Reply with exactly: AUTH_OK', '--model', 'haiku'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 90_000,
      input: ''
    });
  } catch (e) {
    fail(`claude CLI недоступен: ${e.message}. Выполни: claude /login`, 2);
  }
  if (!out.includes('AUTH_OK')) {
    fail(`CLI не аутентифицирован (ответ: ${out.trim().slice(0, 120)}). Выполни: claude /login`, 2);
  }
  console.log('[crosscheck] аутентификация подтверждена.');
}

function buildPrompt(agent) {
  const claims = agent.claims.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return [
    'Ты — независимый исследователь, перепроверяющий архитектурный отчёт по актуальному коду репозитория (не по тексту отчёта).',
    'Отчёт: ' + REPORT + ' — можешь прочитать его для контекста, но вердикты выноси ТОЛЬКО по коду.',
    '',
    'Проверь каждое утверждение ниже. Классификация вердикта:',
    '  CONFIRMED-OPEN — подтверждено, риск актуален;',
    '  CONFIRMED-FIXED-SINCE — подтверждено, но уже исправлено в рабочем дереве (укажи, чем именно);',
    '  REFUTED — не подтверждается кодом (обязательно приведи file:line с опровержением);',
    '  NEW-RISK — риск, отсутствующий в отчёте, который ты нашёл при проверке.',
    '',
    'УТВЕРЖДЕНИЯ ДЛЯ ПРОВЕРКИ:',
    claims,
    '',
    'Ключевые файлы (читай их целиком, без изменений):',
    agent.files,
    '',
    'Правила:',
    '- Инструменты: только Read/Glob/Grep (и Write — исключительно для итогового файла).',
    '- Исходники НЕ менять. Никаких Bash-команд.',
    '- Каждый вердикт — с доказательством: путь:строка и 1-2 строки цитаты.',
    '',
    'Итоговый файл запиши СТРОГО в: .claude-flow/research/crosscheck/crosscheck-' + agent.id + '.md',
    'Формат: заголовок, затем по каждому утверждению секцию с вердиктом и доказательствами,',
    'в конце раздел «NEW RISKS» (или «none»).',
    'После записи файла ответь одной строкой: DONE crosscheck-' + agent.id + '.md (<N> confirmed, <M> refuted, <K> new).'
  ].join('\n');
}

function runAgent(agent) {
  return new Promise((resolve) => {
    const args = [
      '-p', buildPrompt(agent),
      '--allowedTools', 'Read', 'Glob', 'Grep', 'Write',
      '--disallowedTools', 'Edit', 'Bash', 'WebFetch', 'WebSearch', 'NotebookEdit'
    ];
    const child = spawn('claude', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* */ } }, 20 * 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      writeFileSync(join(OUT_DIR, agent.id + '.stdout.txt'), out + (err ? `\n[stderr]\n${err}` : ''), 'utf8');
      resolve({ id: agent.id, code, out });
    });
  });
}

async function main() {
  checkAuth();
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('[crosscheck] запуск 4 headless-агентов (iron / rdpjs / comhost / analyst)…');
  const results = await Promise.all(AGENTS.map(runAgent));

  // Сводка.
  console.log('\n===== РЕЗУЛЬТАТЫ АГЕНТОВ =====');
  for (const r of results) {
    const mdPath = join(OUT_DIR, 'crosscheck-' + r.id + '.md');
    const ok = existsSync(mdPath);
    const line = (r.out.match(/DONE crosscheck-.*$/m) || ['(нет итоговой строки)'])[0].trim();
    console.log(`  ${r.id.padEnd(8)} exit=${r.code} file=${ok ? 'ok' : 'ОТСУТСТВУЕТ'}  ${line}`);
    if (!ok) console.log(`           → вердикт остался только в stdout: .claude-flow/research/crosscheck/${r.id}.stdout.txt`);
  }

  // Грубая сводка разногласий по маркерам вердиктов.
  console.log('\n===== РАЗНОГЛАСИЯ С R1–R8 (по маркерам) =====');
  for (const agent of AGENTS) {
    const mdPath = join(OUT_DIR, 'crosscheck-' + agent.id + '.md');
    if (!existsSync(mdPath)) continue;
    const md = readFileSync(mdPath, 'utf8');
    const refuted = (md.match(/REFUTED/g) || []).length;
    const confirmed = (md.match(/CONFIRMED/g) || []).length;
    const news = (md.match(/NEW-RISK/g) || []).length;
    console.log(`  ${agent.id.padEnd(8)} confirmed=${confirmed} refuted=${refuted} new=${news}`);
    if (refuted > 0) {
      for (const line of md.split('\n')) {
        if (line.includes('REFUTED')) console.log(`    ${line.trim().slice(0, 140)}`);
      }
    }
  }

  // Контроль: агенты не трогали исходники.
  let dirty = '';
  try {
    dirty = execFileSync('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain', '--', 'src/', 'tests/'], {
      cwd: ROOT, encoding: 'utf8'
    });
  } catch { /* git недоступен — пропускаем контроль */ }
  if (dirty.trim()) {
    console.error('\n[crosscheck] ВНИМАНИЕ: исходники изменены во время прогона — проверь git status:');
    console.error(dirty);
  } else {
    console.log('\n[crosscheck] исходники не тронуты (git status src/ tests/ чист).');
  }
  console.log(`\nСледующий шаг: свести вердикты в приложение к ${REPORT} и обновить статусы R1–R8.`);
}

main().catch((e) => fail(e.message));
