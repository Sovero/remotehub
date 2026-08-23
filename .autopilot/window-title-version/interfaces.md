# Interfaces — что изменилось для следующих тикетов

## Main

- Заголовок главного окна: `Remote Hub v<версия>` (`app.getVersion()`).
  В dev это версия Electron, в packaged — версия приложения.
- `page-title-updated` → `preventDefault()`: HTML `<title>` не трогает заголовок окна.

## Смоук

- Базовый смоук (все `RH_SMOKE_*`) проверяет `mainWindow.getTitle()` по шаблону
  `/^Remote Hub v\d+\.\d+\.\d+$/` — заголовок окна всегда содержит версию.
