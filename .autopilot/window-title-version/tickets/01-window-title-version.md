# T01 — версия в заголовке окна

Требования: R01–R03

## Что сделано

- `createWindow`: `title: Remote Hub v${app.getVersion()}`.
- `page-title-updated` → `preventDefault()` — HTML `<title>` не перезаписывает.
- Базовый смоук проверяет заголовок окна по шаблону `Remote Hub vX.Y.Z`.
- CHANGELOG.md: строка в 0.1.3.

## Файлы

- `src/main/index.ts`
- `CHANGELOG.md`
