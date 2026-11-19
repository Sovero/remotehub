#!/usr/bin/env node
/**
 * Локальная сборка инсталлятора без релизных побочных эффектов.
 *
 * `npm run dist` — это релизный путь: он бампает версию в package.json и заливает
 * latest.yml в уже существующий GitHub-релиз. Для «просто собрать у себя» это
 * ловушка: правится отслеживаемый файл (в котором могут быть чужие правки), а
 * чужой релиз получает latest.yml от незакоммиченного дерева.
 *
 * Здесь повторены только шаги сборки из .github/workflows/release.yml, без бампа
 * и без публикации:
 *   1. снести несовместимую сборку ssh2 (иначе electron-vite запекает её в бандл);
 *   2. пересобрать нативные модули под ABI Electron;
 *   3. собрать renderer и main;
 *   4. собрать NSIS-инсталлятор с --publish never.
 *
 * В конце печатается путь к готовому файлу в release/.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (label, command) => {
  console.log(`\n[dist:local] ${label}: ${command}`);
  // Одна строка и shell: на Windows npx/npm — это .cmd, а spawnSync без shell
  // такие файлы не запускает; разбивать на args+shell тоже нельзя (deprecation).
  const res = spawnSync(command, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (res.status !== 0) {
    console.error(`[dist:local] шаг «${label}» завершился с кодом ${res.status ?? res.signal}`);
    process.exit(res.status ?? 1);
  }
};

// Шаг из workflow: ssh2 держит свою сборку мимо @electron/rebuild, и electron-vite
// копирует её в бандл с чужим ABI. ssh2 умеет работать и на чистом JS.
rmSync(resolve(root, 'node_modules/ssh2/lib/protocol/crypto/build'), { recursive: true, force: true });

run('нативные модули', 'npx electron-builder install-app-deps');
run('сборка', 'npm run build');
run('инсталлятор', 'npx electron-builder --win --x64 --publish never');

const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const exe = resolve(root, 'release', `Remote Hub Setup ${version}.exe`);
if (!existsSync(exe)) {
  console.error(`[dist:local] инсталлятор не найден: ${exe}`);
  process.exit(1);
}
const mb = (statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`\n[dist:local] готово: ${exe} (${mb} МБ, версия ${version})`);
console.log('[dist:local] latest.yml не заливался, версия в package.json не менялась');
