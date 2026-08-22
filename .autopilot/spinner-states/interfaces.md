# Интерфейсы: иконки состояний (спиннеры загрузки)

## Icon.tsx
- Новое имя иконки: `'spinner'` (дуга окружности, stroke = currentColor).
- Использование: `<Icon name="spinner" size={N} className="icon-spin" />` — вращение задаёт CSS-класс.

## global.css
- `.icon-spin { animation: icon-spin 0.8s linear infinite; }` и `@keyframes icon-spin { to { transform: rotate(360deg); } }` — общий механизм для всех спиннеров.
- `.sftp-loading { display: inline-flex; align-items: center; gap: 7px; }` — строка загрузки каталога.

## Смоук
- `RH_SMOKE_ICONS=1`: после проверки кнопок/меню/диалога кликает кнопку массовой проверки (`.sidebar-header .btn`), ждёт появления `svg.icon-spin` (до 4 с), кликает снова и ждёт возврата к `refresh`. Результат: `ok:…:spinner=1`.
