// Поднимает версию в package.json по правилам семантического версионирования
// (semver): строго MAJOR.MINOR.PATCH, без pre-release и метаданных сборки.
//
// По умолчанию — патч (0.1.0 → 0.1.1). Флаги: --minor, --major.
// Вызывается автоматически из скриптов dist / dist:sign перед сборкой,
// поэтому каждый релизный билд получает новую монотонно растущую версию
// (электронный апдейтер отдаёт обновление только на более высокую версию,
// а инсталляторы с одинаковой версией неразличимы).
//
// Формат package.json сохраняется байт-в-байт — заменяется только строка
// "version": "..." (включая отступы и переводы строк файла).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = resolve(root, 'package.json');
const raw = readFileSync(pkgPath, 'utf8');

const match = raw.match(/"version"\s*:\s*"([^"]+)"/);
if (!match) {
  console.error('bump-version: поле version в package.json не найдено');
  process.exit(1);
}

const current = match[1];
const semver = /^(\d+)\.(\d+)\.(\d+)$/;
const parts = current.match(semver);
if (!parts) {
  console.error(`bump-version: «${current}» не соответствует правилам semver (MAJOR.MINOR.PATCH)`);
  process.exit(1);
}

const [, major, minor, patch] = parts.map(Number);
const kind = process.argv.includes('--major')
  ? 'major'
  : process.argv.includes('--minor')
    ? 'minor'
    : 'patch';

let nextMajor = major;
let nextMinor = minor;
let nextPatch = patch;
if (kind === 'major') {
  nextMajor = major + 1;
  nextMinor = 0;
  nextPatch = 0;
} else if (kind === 'minor') {
  nextMinor = minor + 1;
  nextPatch = 0;
} else {
  nextPatch = patch + 1;
}

const next = `${nextMajor}.${nextMinor}.${nextPatch}`;
writeFileSync(pkgPath, raw.replace(match[0], `"version": "${next}"`));
console.log(`bump-version: ${current} → ${next} (${kind})`);
