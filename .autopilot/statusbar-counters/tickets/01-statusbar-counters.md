# T01 — индикатор «хосты / сессии» в строке статуса

Требования: R01, R02, R03, A01

## Что сделано

- `Icon.tsx`: новые иконки `tree` (ствол + ветви) и `tab` (вкладка с выступом).
- `StatusBar.tsx`: группа `.statusbar-counters` с двумя счётчиками (хосты из дерева через
  `flattenHosts`, активные сессии — фазы connecting/connected/auth-required), разделителем
  и тултипом.
- `global.css`: стили счётчиков (`tabular-nums`, разделитель).
- `index.ts`: смоук иконок дополнен проверкой счётчиков (`counters=1`).

## Файлы

- `src/renderer/src/components/Icon.tsx`
- `src/renderer/src/components/StatusBar.tsx`
- `src/renderer/src/styles/global.css`
- `src/main/index.ts`
