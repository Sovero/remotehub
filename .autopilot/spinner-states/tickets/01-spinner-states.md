# T01: Иконки состояний (спиннеры загрузки)

## Требования
R01, R02, R03, R03.1, A01, A02

## Что сделать
1. `src/renderer/src/components/Icon.tsx` — добавить иконку `spinner` (дуга).
2. `src/renderer/src/styles/global.css` — класс `.icon-spin` + `@keyframes icon-spin`; стиль `.sftp-loading`.
3. `Sidebar.tsx` — кнопка массовой проверки: `spinner`+`icon-spin` при проверке, `refresh` в покое.
4. `TabBar.tsx` — вкладка `connecting`: `spinner`+`icon-spin` вместо пульсирующей точки.
5. `SftpPane.tsx` — спиннер в панели подключения и в «Загрузка…».
6. `App.tsx` — панель «Запуск Remote Desktop…»: спиннер.
7. `UpdateBar.tsx` — спиннер в «Проверка обновлений…».
8. `src/main/index.ts` — расширить смоук `RH_SMOKE_ICONS` проверкой спиннера.

## Готово, когда
- Смоук иконок проходит в dev и packaged: `spinner=1`.
- 107/107 тестов, typecheck чист, установщик пересобран.
