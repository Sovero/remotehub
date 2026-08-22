# Интерфейсы: анимация папки группы при перетаскивании хоста

## ProtocolIcon
- Пропсы группы: `{ protocol: 'group'; size?: number; open?: boolean; drag?: boolean }`.
- `drag` приоритетнее `open`: при true — «приоткрытая» папка (крышка приподнята наполовину, 2 path).

## TreeView / CSS
- `GroupRow` передаёт `drag={dragOver}` и вешает `tree-folder--drag` на `.tree-folder`.
- `.tree-folder--drag { color: var(--accent); }` + `svg { animation: folder-ajar 0.9s ease-in-out infinite; }` (scale 1→1.18, rotate -6°).
- Уход мыши/бросание снимают `dragOver` — иконка возвращается к `open`-состоянию, цвет — к `var(--warn)`.

## Смоук
- `RH_SMOKE_ICONS`: после проверки сворачивания группы — синтетический `DragEvent('dragover', { dataTransfer: new DataTransfer() })` → ожидается `.tree-folder--drag` + папка из 2 path; затем `dragleave` → класс исчезает. Результат `…:drag=1`.
