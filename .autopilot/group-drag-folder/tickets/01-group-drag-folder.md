# T01: Анимация папки группы при перетаскивании хоста

## Требования
R01, R02, R03, R04, A01, A02

## Что сделать
1. `src/renderer/src/components/ProtocolIcon.tsx` — проп `drag?: boolean`: «приоткрытая» папка (полуподнятая крышка + лоток), приоритет над `open`.
2. `src/renderer/src/components/TreeView.tsx` — `GroupRow`: `drag={dragOver}` в ProtocolIcon и класс `tree-folder--drag` на обёртке.
3. `src/renderer/src/styles/global.css` — `.tree-folder--drag` (акцентный цвет), `@keyframes folder-ajar` (пульс), transition цвета.
4. `src/main/index.ts` — смоук: синтетический dragover/dragleave на группе.

## Готово, когда
- `RH_SMOKE_ICONS` зелёный в dev и packaged: `…:drag=1` (подсветка появляется, папка из 2 path, после dragleave не залипает).
- `RH_SMOKE_CONTRAST` зелёный, 107/107 тестов, typecheck чист, установщик пересобран.
