# T01 — правила версионирования билдов

Требования: R01, R02, R03, R04

## Что сделано

- `scripts/bump-version.mjs`: semver-бамп с валидацией (patch по умолчанию, --minor/--major).
- `package.json`: скрипты `dist` и `dist:sign` начинаются с бампа версии.
- Собран `npm run dist` → 0.1.0 → 0.1.1, `release/Remote Hub Setup 0.1.1.exe`.

## Файлы

- `scripts/bump-version.mjs`
- `package.json`
