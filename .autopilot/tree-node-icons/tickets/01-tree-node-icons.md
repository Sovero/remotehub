# T01: Иконки узлов дерева профилей (группы, папки, развёрнутые узлы)

## Требования
R01, R02, R03, R04, A01, A02

## Что сделать
1. `src/renderer/src/components/ProtocolIcon.tsx` — вариант `'group'` с `open?: boolean`: открытая/закрытая папка, stroke = currentColor.
2. `src/renderer/src/components/TreeView.tsx` — шеврон через `<Icon name="chevron-down">` в `.tree-chevron`, папка через `<ProtocolIcon protocol="group" open={!group.collapsed} />`.
3. `src/renderer/src/styles/global.css` — `.tree-chevron`/`.tree-chevron--closed`/`.tree-folder` под SVG (убрать глифы и font-size).
4. `.freebuff/seed-icons-userdata.cjs` — группа «Серверы» (с хостом h1) в дереве.
5. `src/main/index.ts` — смоук иконок: проверка группы (размер svg, path-счётчик, переключение сворачивания); смоук контраста: скан `.tree-folder`/`.tree-chevron`.

## Готово, когда
- `RH_SMOKE_ICONS` зелёный в dev и packaged: `…:group=1`.
- `RH_SMOKE_CONTRAST` зелёный в dev и packaged: новые элементы ≥ 3:1 во всех 12 комбинациях.
- 107/107 тестов, typecheck чист, установщик пересобран.
