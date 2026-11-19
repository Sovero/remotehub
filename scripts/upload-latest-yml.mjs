#!/usr/bin/env node
/**
 * Загружает latest.yml в GitHub Release текущей версии.
 * Вызывается из npm run dist после electron-builder.
 *
 * Требует: gh CLI (GitHub CLI), авторизованный через `gh auth login`.
 *
 * Поведение:
 *  - Если релиз для текущей версии существует — загружает/обновляет latest.yml.
 *  - Если релиза нет — пропускает (релиз будет создан позже вручную или через CI).
 *  - Если latest.yml нет в release/ — пропускает с предупреждением.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const latestYml = resolve(root, 'release', 'latest.yml');

/**
 * Грязное дерево — повод сказать вслух: файл, который сейчас уйдёт в релиз,
 * собран не из коммита тега, и автообновление поедет к пользователям с кодом,
 * которого нет ни в одном теге. В CI дерево грязное штатно (workflow переписывает
 * версию в package.json), поэтому там только строка в лог.
 */
function warnIfTreeDirty() {
  let dirty = '';
  try {
    // Только хвостовой перевод строки: trim() съел бы ведущий пробел статуса
    // первой строки (" M file") и сдвинул бы имена файлов на символ.
    dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).replace(/\s+$/, '');
  } catch {
    return; // не git-репозиторий — предупреждать не о чем
  }
  if (!dirty) return;

  const files = dirty.split(/\r?\n/).map((line) => line.slice(3).trim());
  if (process.env.CI) {
    console.log(`upload-latest-yml: дерево изменено (${files.length} файлов) — в CI это ожидаемо`);
    return;
  }
  console.warn(`upload-latest-yml: ВНИМАНИЕ — рабочее дерево изменено (${files.length}):`);
  for (const file of files.slice(0, 10)) console.warn(`  - ${file}`);
  if (files.length > 10) console.warn(`  … и ещё ${files.length - 10}`);
  console.warn(
    'upload-latest-yml: latest.yml описывает сборку не из коммита тега — автообновление получит незакоммиченный код'
  );
}
warnIfTreeDirty();

if (process.env.RH_UPLOAD_DRY_RUN) {
  console.log('upload-latest-yml: RH_UPLOAD_DRY_RUN — ничего не загружаю');
  process.exit(0);
}

if (!existsSync(latestYml)) {
  console.log(`upload-latest-yml: release/latest.yml не найден — пропускаем`);
  process.exit(0);
}

// Проверяем, существует ли релиз на GitHub
try {
  execSync(`gh release view "${tag}" --json tagName`, {
    stdio: 'pipe',
    cwd: root
  });
} catch {
  console.log(`upload-latest-yml: релиз ${tag} не найден на GitHub — пропускаем`);
  process.exit(0);
}

// Загружаем latest.yml (--clobber перезаписывает если уже есть)
try {
  execSync(`gh release upload "${tag}" "${latestYml}" --clobber`, {
    stdio: 'inherit',
    cwd: root
  });
  console.log(`upload-latest-yml: latest.yml загружен в ${tag}`);
} catch (err) {
  console.error(`upload-latest-yml: ошибка загрузки — ${err.message}`);
  process.exit(1);
}
