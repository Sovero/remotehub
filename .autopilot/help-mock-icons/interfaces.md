# Интерфейсы

## Иконки в моках справки

- `IconPath({ x, y, d, className?, w? })` — встраивает path-иконку набора в SVG-схему справки;
  `d` — строка или массив строк из карты `ICON` (совпадает с `Icon.tsx`), цвета — классы `m-stroke-*`.
- `ICON` — карта path-данных иконок, используемых в моках: `chevron-up`, `chevron-down`, `arrow-down`,
  `check`, `folder`, `file`, `upload`, `download`, `expand`.
- Смоук: `RH_SMOKE_ICONS` дополнительно открывает справку и проверяет моки (`help=1` в выводе).
