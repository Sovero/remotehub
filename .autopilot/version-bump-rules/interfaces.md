# Interfaces — что изменилось для следующих тикетов

## Скрипты

- `scripts/bump-version.mjs` — semver-бамп версии в package.json:
  - `node scripts/bump-version.mjs` — патч (по умолчанию)
  - `node scripts/bump-version.mjs --minor` — минор (сброс PATCH)
  - `node scripts/bump-version.mjs --major` — мажор (сброс MINOR и PATCH)
  - Строго `MAJOR.MINOR.PATCH`; pre-release (`1.0.0-beta`) и мусор — ошибка выхода ≠0 (билд останавливается).
  - Формат package.json сохраняется байт-в-байт (заменяется только строка `"version"`).
  - Экспорт: `bumpVersion(current, kind)` (чистая функция для тестов), CLI при прямом запуске.

## package.json

- `dist` и `dist:sign` начинаются с `node scripts/bump-version.mjs` — каждый релизный билд получает новую монотонно растущую версию (нужно electron-updater'у и различимости инсталляторов).
- Версия в UI (статусбар) и в установщике берётся из package.json автоматически.

## Артефакт

- `release/Remote Hub Setup 0.1.1.exe` — подписанный установщик с новой версией.
