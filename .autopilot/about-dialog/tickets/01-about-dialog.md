# T01 — диалог «О программе» с changelog

Требования: R01–R05

## Что сделано

- `CHANGELOG.md` в корне (0.1.0–0.1.2), добавлен в `files` electron-builder.
- `src/shared/changelog.ts` — парсер Keep-a-Changelog, `tests/changelog.test.ts` (8 тестов).
- IPC `app:changelog` (main, путь от `__dirname`) + preload `getChangelog` + контракт.
- `AboutDialog` (Modal): логотип, версия/Electron/arch, changelog последнего релиза.
- Тип диалога `'about'` в сторе, регистрация в DialogRoot.
- Версия в статусбаре — кнопка `.statusbar-version`, открывает «О программе».
- CSS: `.statusbar-version` + `.about-*`.
- Смоук иконок: `about=1` — открытие диалога, версия, changelog, закрытие.

## Файлы

- `CHANGELOG.md`, `src/shared/changelog.ts`, `tests/changelog.test.ts`
- `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/ipc-contract.ts`
- `src/renderer/src/components/dialogs/AboutDialog.tsx`
- `src/renderer/src/components/DialogRoot.tsx`, `StatusBar.tsx`, `store.ts`
- `src/renderer/src/styles/global.css`, `src/main/index.ts`, `package.json`
