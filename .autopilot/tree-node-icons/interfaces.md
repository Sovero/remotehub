# Интерфейсы: иконки узлов дерева профилей

## ProtocolIcon
- Пропсы: `{ protocol: Protocol | 'group'; size?: number; open?: boolean }`.
- `protocol === 'group'`: открытая папка (2 path) при `open`, закрытая (1 path) иначе; stroke = currentColor.
- Протоколы — без изменений.

## TreeView / CSS
- `.tree-chevron` (inline-flex, 14px, muted, transition transform) + `.tree-chevron--closed` (rotate -90°).
- `.tree-folder` (inline-flex, `var(--warn)`) — обёртка иконки группы.
- Шеврон сворачивания — `<Icon name="chevron-down">` (уже в наборе иконок).

## Смоуки
- `RH_SMOKE_ICONS`: добавлена проверка группы — svg папки ≥ 8px, у открытой 2 path, клик сворачивает (шеврон `--closed`, 1 path) и разворачивает обратно. Результат `…:group=1`.
- `RH_SMOKE_CONTRAST`: в скан добавлены `.tree-folder` и `.tree-chevron`.
- Смоук-сид (`.freebuff/seed-icons-userdata.cjs`) содержит группу «Серверы» с хостом внутри и два верхнеуровневых хоста (всего 3 хоста — `RH_EXPECT_HOSTS=3`).
