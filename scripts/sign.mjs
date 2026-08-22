// Скрипт сборки с код-подписью.
//
// Загружает учётные данные сертификата из cert.env (файл добавлен в .gitignore)
// и передаёт их electron-builder через стандартные переменные окружения
// CSC_LINK / CSC_KEY_PASSWORD (WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD также
// поддерживаются). Если сертификат не задан, сборка продолжается без подписи.
//
// Пример cert.env — см. cert.env.example.

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Читает KEY=VALUE файл (поддержка комментариев и кавычек) и кладёт значения в process.env. */
function loadEnvFile(file) {
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    // Реальное окружение важнее файла.
    if (key in process.env) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(resolve(projectRoot, 'cert.env'));

const certLink = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
if (!certLink) {
  console.warn('⚠  Сертификат не найден (CSC_LINK): сборка будет без код-подписи.');
  console.warn('   Скопируйте cert.env.example → cert.env и укажите PFX-сертификат.');
} else {
  console.log('🔏 Подписываю сертификатом:', certLink);
}

const { build, Platform, Arch } = require('electron-builder');

build({
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
})
  .then(() => {
    if (certLink) console.log('✔  Инсталлятор собран и подписан.');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
