# Спека: иконки узлов дерева профилей

## Контекст

Дерево профилей в сайдбаре рисовало группы текстовыми глифами: шеврон `▸` (CSS-поворот при сворачивании) и папку `▣` (цвет `var(--warn)`). ProtocolIcon знал только протоколы (ssh/telnet/rdp/vnc). Полёт расширяет ProtocolIcon на узлы дерева и переводит дерево на SVG.

## Требования

### R01/R02 — иконка группы в ProtocolIcon
- `ProtocolIcon` принимает `protocol: Protocol | 'group'` и опциональный `open?: boolean`.
- Для `'group'` рисует папку:
  - `open` (развёрнутый узел) — открытая папка: поднятая крышка + основание (2 path);
  - свёрнутый — закрытая папка (1 path).
- Строка обводки — `currentColor`: цвет задаёт тема (`var(--warn)` через класс `.tree-folder`), как у прежнего глифа.
- Для протоколов поведение не меняется.

### R03 — дерево на SVG
- `TreeView.GroupRow`:
  - шеврон — `<Icon name="chevron-down" />` в `.tree-chevron`, при свёрнутом узле класс `tree-chevron--closed` поворачивает на -90° (как раньше);
  - папка — `<ProtocolIcon protocol="group" open={!group.collapsed} />`.
- CSS: `.chevron` → `.tree-chevron` (inline-flex, ширина 14px, muted, transition), `.tree-folder` — inline-flex, `var(--warn)`.

### R04 — контраст
- Смоук `RH_SMOKE_CONTRAST` сканирует `.tree-folder` и `.tree-chevron` наравне с остальными иконками (порог 3:1, 2 темы × 6 акцентов). Папка-янтарь: 4.5–4.8:1, шеврон: ~4.8:1.

### A01 — функциональная проверка
- Смоук `RH_SMOKE_ICONS` (смоук-сид теперь содержит группу «Серверы»):
  - у группы есть `.tree-folder svg` (≥ 8px) и `.tree-chevron`;
  - развёрнутая папка — 2 path, шеврон без `--closed`;
  - клик по группе: шеврон получает `tree-chevron--closed`, папка — 1 path (закрыта);
  - повторный клик возвращает развёрнутое состояние.
  - Результат: `…:group=1`.

## Проверка
- `RH_SMOKE_ICONS` и `RH_SMOKE_CONTRAST` зелёные в dev и packaged.
- 107/107 тестов, typecheck обоих проектов чист.
