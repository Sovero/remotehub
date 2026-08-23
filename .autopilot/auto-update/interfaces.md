# Interfaces — что изменилось для следующих тикетов

## Стор (renderer)

- `update: UpdateStatus` — живое состояние автообновления.
- `checkUpdates() / downloadUpdate() / installUpdate() / dismissUpdate()` —
  ручная проверка, скачивание, установка, скрытие баннера. Вызываются из
  `UpdateBar` и из секции «Обновления» в `AboutDialog`.

## UI

- `UpdateBar` — баннер над контентом: `checking` (спиннер), `available`
  (версия + переключатель «Что нового» с release notes + «Скачать»),
  `downloading` (процент + прогресс-бар), `downloaded` («Перезапустить
  и установить» + «Позже»), `error` («Повторить»).
- `AboutDialog` — секция «Обновления»: статус + действия. Классы
  `.about-update`, `.about-update__row`, `.about-update__notes`,
  `.about-update__actions`.

## Main

- `Updater` (без изменений): старт-проверка через 8 с, интервал 4 ч,
  ручная `check(true)` из меню и через IPC `update:check`.
- `releaseNotes` в `UpdateStatus.available` — строка (из GitHub Releases).

## Смоук

- `RH_SMOKE_UPDATE=1` — гоняет все состояния обновления в сторе и проверяет
  баннер и «О программе». Требует `RH_EXPECT_HOSTS` (3 для сид-профилей).
