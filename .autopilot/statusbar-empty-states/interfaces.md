# Интерфейсы: иконки в строке статуса и пустых состояниях

## Icon.tsx
- Новое имя иконки: `'warning'` (треугольник + восклицательный знак).

## StatusBar / CSS
- `.statusbar-item` — inline-flex, gap 5px; `.statusbar-state--connected` (`--ok`), `--error` (`--danger`), `--auth-required` (`--warn`).
- Иконки состояний: connecting — `spinner.icon-spin`, connected — `check`, auth-required — `key`, error — `warning`, closed — `power`; «Готово» — `check`.
- Светлая тема: `--ok: #259e57` (≥ 3.4:1 на белом).

## Пустые состояния
- `EmptyWorkspace`: `<Icon name="host" size={44}/>` в `.placeholder-icon` (монитор).
- `Welcome`: логотип `<Icon name="host" size={56}/>` (акцентный цвет).
- `PlaceholderPane`: `<Icon name="code" size={44}/>`.

## Смоук
- `RH_SMOKE_CONTRAST`: в скан добавлены `.statusbar-item` (порог 3:1).
