# Интерфейсы (что изменил полёт ui-icons)

## Поведение

- Кнопки интерфейса получили иконки (инлайн-SVG, цвет — currentColor); подписи сохранены.
- Кнопки-иконки без текста стали компактнее (`.btn--icon`).

## Изменённые файлы

- `src/renderer/src/components/Icon.tsx` — новый компонент `Icon({ name, size?, className? })`,
  тип `IconName` (~30 имён).
- Кнопки: `Sidebar`, `TabBar`, `SessionOverlay`, `App` (RDP-панели), `VncViewer`, `SftpPane`,
  `TerminalPane`, `ContextMenu`, `Welcome`, `UpdateBar`, `InteractiveTour` и все диалоги.
- `src/renderer/src/styles/global.css` — `.btn` inline-flex/gap; `.btn--icon`; `.ctxmenu-icon`;
  `.host-list-go`.
- `src/main/index.ts` — смоук `RH_SMOKE_ICONS`.

## Контракт для следующих тикетов

- `Icon` — единственная точка добавления иконок: новый `IconName` + JSX-путь в `PATHS`.
- `MenuItem` (контекстное меню) получил опциональное поле `icon?: IconName`.
- `RH_SMOKE_ICONS=1` — смоук: кнопки сайдбара/таббара/контекстного меню/диалога содержат svg
  ненулевого размера; вывод `[smoke] icons flow OK — footer=N:ctx=N:actions=N`.
