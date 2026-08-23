# T01 — автообновление: ручная проверка, release notes, смоук

Требования: R01–R05

## Что сделано

- `AboutDialog`: секция «Обновления» с живым статусом (все состояния
  `UpdateStatus`) и кнопками «Проверить обновления» / «Скачать» /
  «Перезапустить и установить».
- `UpdateBar`: в `available` добавлен переключатель «Что нового»,
  раскрывающий release notes.
- CSS: `.about-update*`, `.update-bar__notes-toggle`, `.update-bar__notes`.
- Смоук `RH_SMOKE_UPDATE` — все состояния баннера + кнопка в «О программе».
- CHANGELOG.md: запись 0.1.3.

## Файлы

- `src/renderer/src/components/dialogs/AboutDialog.tsx`
- `src/renderer/src/components/UpdateBar.tsx`
- `src/renderer/src/styles/global.css`
- `src/main/index.ts`
- `CHANGELOG.md`, `package.json`
