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
