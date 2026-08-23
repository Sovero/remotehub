# Interfaces — что изменилось для следующих тикетов

## Settings (shared)

- `lastSeenVersion: string | null` — версия, для которой «Что нового» уже
  показано (`null` — никогда). Добавлен в `DEFAULT_SETTINGS`; старые файлы
  настроек дополняются значением по умолчанию при загрузке.

## Стор (renderer)

- `maybeShowWhatsNew(): Promise<void>` — сравнение `settings.lastSeenVersion`
  с `appInfo.version`; открывает диалог `{ type: 'whats-new' }` при смене
  версии (кроме чистого первого запуска) и запоминает текущую версию.
  Вызывается автоматически из `init()`.

## UI

- `WhatsNewDialog` (Modal 460): заголовок «Что нового», «Remote Hub обновлён»,
  changelog последнего релиза (`.about-changelog*`), кнопка «Понятно».
- `DialogState` → `{ type: 'whats-new' }`.

## Смоук

- Смоук иконок: `whatsnew=1` — сценарий обновления (старая `lastSeenVersion`
  → диалог + запись версии + повторный вызов ничего не открывает) и первый
  запуск (без диалога, версия запоминается).
