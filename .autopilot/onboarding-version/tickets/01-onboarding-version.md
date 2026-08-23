# T01 — версия в заставке и онбординге

Требования: R01–R03

## Что сделано

- `LoadingSplash` в App.tsx: логотип, имя, «Версия X.Y.Z», анимация «Загрузка…».
- `InteractiveTour`: `.tour-tooltip-version` (vX.Y.Z) в футере тултипа.
- CSS: `.loading*`, `.tour-tooltip-version`.
- Смоук иконок: `ui-version=1` (заставка + тур).
- CHANGELOG.md: 0.1.4.

## Файлы

- `src/renderer/src/App.tsx`
- `src/renderer/src/components/InteractiveTour.tsx`
- `src/renderer/src/styles/global.css`
- `src/main/index.ts`
- `CHANGELOG.md`, `package.json`
