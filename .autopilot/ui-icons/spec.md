# Спека: иконки для кнопок

## Задача

Добавить иконки к кнопкам интерфейса. Бриф: «к кнопкам добавить иконки» — без уточнения
списка, поэтому берём все видимые кнопки. Текст кнопок сохраняется (это важно: смоуки ищут
кнопки по textContent, а пользователь привык к подписям).

## Решение

1. **`Icon.tsx`** — единый компонент: реестр `IconName → JSX` (stroke-иконки, viewBox 16×16,
   `stroke=currentColor`, round caps). ~30 иконок: plus, folder-plus, host, import, export, key,
   gear, close, refresh, stop, check, pencil, trash, expand, window, arrow-*, chevron-*, upload,
   download, save, link, code, power, search, copy, play, folder, arrow-left.
   Подход повторяет уже принятый в `ProtocolIcon.tsx` (инлайн-SVG, без зависимостей).
2. **CSS** — `.btn` становится `inline-flex` с `gap: 6px` (текст без иконок не страдает);
   `.btn--icon` — компактные кнопки только с иконкой; выравнивание `.ctxmenu-icon`, `.host-list-go`.
3. **Сайдбар** — кнопки футера (＋ Группа → folder-plus, ＋ Хост → host, Импорт → import,
   Экспорт → export, 🔑 Учётные данные → key, ⚙ Настройки → gear), заголовок (проверка
   доступности: refresh/stop), закрытие настроек и тултипа (close).
4. **Панель вкладок** — новая сессия (plus), туннели (link), сниппеты (code), сохранить профиль
   (save), закрыть вкладку (close).
5. **Панели сессий** — SessionOverlay (refresh/close), RDP-тулбар и фолбэк (expand/window/close),
   VNC «Полный экран» (expand), SFTP-тулбар (refresh/arrow-up/upload/folder-plus) и действия
   строк (arrow-right/download/pencil/trash), поиск терминала (chevron-up/chevron-down/close).
6. **Диалоги** — Modal-close (close), Confirm (close/trash или check), Group/Host
   (close/check), Import (close/copy/import), Password (close/play), Credentials и Snippets
   (pencil/trash/plus/folder/arrow-left/check), Help (play/close), NewSession (play у строк),
   Welcome (folder-plus/host), UpdateBar (download/power/refresh/close), InteractiveTour
   (close/arrow-left/check/arrow-right), TunnelsDialog (plus/stop).
7. **Контекстное меню** — у `MenuItem` появилось поле `icon`; пункты меню хоста/группы получают
   иконки (play/folder/search/pencil/copy/trash/host/folder-plus).

## Пользовательские истории

| # | Метка | История | Приёмка |
|---|-------|---------|---------|
| 1 | R01 | Как пользователь, я вижу иконки на кнопках по всему интерфейсу | смоук `RH_SMOKE_ICONS`: у кнопок сайдбара, таббара, пунктов контекстного меню и кнопок диалога есть svg ненулевого размера |
| 2 | R01.1 | …и подписи кнопок никуда не делись | кнопки «Полный экран», «Встроить во вкладку», «Переподключить» и др. находят по textContent — RDP-смоук зелёный |
| 3 | R01.2 | …и приложение работает без новых зависимостей | package.json не менялся |

## Решения по реализации

1. Один компонент `Icon` вместо копипасты svg; размер задаётся пропом `size`, цвет — `currentColor`.
2. Текст кнопок не тронут: иконки встают рядом с подписью (flex + gap), а не заменяют её.
3. Смоук `RH_SMOKE_ICONS` (dev и packaged): footer=6, ctx=6, actions=2 — все с видимым svg.
4. RDP/VNC-смоуки перепрогнаны после правок тулбаров — зелёные.

## Вне рамок

| Требование | Почему не сейчас |
|---|---|
| Анимации/анимированные иконки | не заказано; статичные stroke-иконки уже дают единый вид |
| Иконки в таблицах/статус-баре вне кнопок | задача про кнопки |

## Покрытие манифеста

| Требование | Раздел спеки |
|---|---|
| R01 | Решение §1–7, История 1 |
| R01.1 | Решение §2, История 2 |
| R01.2 | Решение §1, История 3 |
| A01 | Решения §3, История 1 |
