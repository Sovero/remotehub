# T01 — «Что нового» после обновления

Требования: R01–R04

## Что сделано

- `Settings.lastSeenVersion: string | null` + `DEFAULT_SETTINGS`.
- Стор: `maybeShowWhatsNew()` (логика сравнения версий), вызов из `init`.
- `WhatsNewDialog` + тип `'whats-new'` в DialogState + DialogRoot.
- CSS: `.whatsnew-head` (общий с `.about-head`).
- Смоук иконок: `whatsnew=1` (обновление + первый запуск).
- CHANGELOG.md: 0.1.5.

## Файлы

- `src/shared/types.ts`
- `src/renderer/src/store.ts`
- `src/renderer/src/components/dialogs/WhatsNewDialog.tsx`
- `src/renderer/src/components/DialogRoot.tsx`
- `src/renderer/src/styles/global.css`
- `src/main/index.ts`
- `CHANGELOG.md`, `package.json`
