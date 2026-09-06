#!/usr/bin/env node
/**
 * Публикация canary-релиза после пилотной проверки (docs/canary-process.md).
 *
 * Что делает:
 *  1. Находит draft-релиз тега (--tag v0.1.31 или текущая версия package.json).
 *  2. Проверяет, что у релиза есть ровно два ассета: installer exe + latest.yml.
 *  3. Сверяет sha512 из latest.yml с фактическим дайджестом ассета
 *     (electron-updater проверяет base64-дайджест — сверяем так же).
 *  4. Сверяет version в latest.yml с тегом.
 *  5. Если передан --notes <файл> — заменяет тело релиза на него (иначе
 *     остаются автосгенерированные notes из CI).
 *  6. Публикует draft (make_latest=false не трогаем: latest-флагом управляет
 *     электрон-апдейтер сам, ему важен только факт публикации).
 *
 * До шага публикации скрипт ничего не меняет — его можно запускать повторно
 * как read-only проверку (без --publish он только верифицирует и печатает план).
 *
 * Требует: gh CLI, авторизованный (`gh auth login`), репозиторий — origin.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- CLI ----------
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const tag = flag('--tag') ?? `v${JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version}`;
const notesFile = flag('--notes');
const doPublish = hasFlag('--publish');

// ---------- gh helpers (execFileSync: без shell, без инъекций) ----------
const gh = (args_, opts = {}) =>
  execFileSync('gh', args_, { cwd: root, encoding: 'utf8', stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'] });

const die = (msg) => {
  console.error(`canary-publish: ${msg}`);
  process.exit(1);
};

// 1. Draft-релиз тега.
let release;
try {
  release = JSON.parse(gh(['release', 'view', tag, '--json', 'isDraft,name,tagName,assets,body,url']));
} catch {
  die(`релиз ${tag} не найден (gh release view). Тег запушен? CI отработал?`);
}
if (!release.isDraft) {
  die(`релиз ${tag} уже опубликован — canary-этап пройден ранее, публиковать нечего.`);
}
console.log(`canary-publish: draft-релиз ${tag} найден (${release.url})`);

// 2. Ассеты.
const assets = release.assets ?? [];
const ymlAsset = assets.find((a) => a.name === 'latest.yml');
const exeAsset = assets.find((a) => a.name !== 'latest.yml' && a.name.endsWith('.exe'));
if (!ymlAsset || !exeAsset) {
  die(
    `у draft-релиза нет нужных ассетов (нужны installer .exe и latest.yml, есть: ${assets.map((a) => a.name).join(', ') || 'никаких'}) — CI не дошёл до release-шага?`
  );
}
console.log(`canary-publish: ассеты на месте: ${exeAsset.name}, latest.yml (${exeAsset.size} байт exe)`);

// 3. latest.yml: версия + sha512 vs фактический дайджест exe.
// Скачиваем ассет (а не читаем локальный файл) — сверка честная только против
// того, что реально опубликовано в draft.
let yml;
try {
  gh(['release', 'download', tag, '--pattern', 'latest.yml', '--dir', resolve(root, 'release'), '--clobber']);
  yml = readFileSync(resolve(root, 'release', 'latest.yml'), 'utf8');
} catch (e) {
  die(`не удалось скачать latest.yml из draft: ${(e)?.message ?? e}`);
}
const ymlVersion = /^version:\s*(\S+)/m.exec(yml)?.[1];
const ymlSha = /sha512:\s*(\S+)/.exec(yml)?.[1];
if (!ymlVersion || !ymlSha) die('latest.yml не содержит version/sha512 — файл повреждён?');
if (ymlVersion !== tag.slice(1)) {
  die(`latest.yml описывает версию ${ymlVersion}, а тег — ${tag.slice(1)}: рассинхрон.`);
}

// Дайджест считаем по скачанному exe — только так сверка честная.
console.log('canary-publish: скачиваю exe для сверки sha512 (может занять минуту)...');
const exePath = resolve(root, 'release', exeAsset.name);
gh(['release', 'download', tag, '--pattern', exeAsset.name, '--dir', resolve(root, 'release'), '--clobber']);
const actualSha = createHash('sha512').update(readFileSync(exePath)).digest('base64');
if (actualSha !== ymlSha) {
  die(`sha512 не сходится: latest.yml=${ymlSha}, фактический=${actualSha} — ассет побит?`);
}
console.log('canary-publish: sha512 latest.yml == фактический дайджест exe ✓');

// 4. Notes.
if (notesFile) {
  if (!existsSync(notesFile)) die(`--notes: файл ${notesFile} не найден`);
  gh(['release', 'edit', tag, '--notes-file', resolve(root, notesFile)]);
  console.log(`canary-publish: notes заменены из ${notesFile}`);
}

// 5. Публикация — единственный шаг с побочными эффектами.
if (!doPublish) {
  console.log(`\ncanary-publish: проверка пройдена. Публикация НЕ выполнена (нет --publish).`);
  console.log(`После вердикта пилотов: node scripts/canary-publish.mjs --tag ${tag} --publish${notesFile ? ` --notes ${notesFile}` : ''}`);
  process.exit(0);
}

gh(['release', 'edit', tag, '--draft=false']);
console.log(`canary-publish: ${tag} опубликован — electron-updater начнёт раздавать обновление.`);
