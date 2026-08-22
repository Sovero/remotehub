# T01 — SVG-иконки в моках справки

Требования: R01, R02, A01, A02

## Что сделано

- `helpContent.tsx`: хелпер `IconPath` + карта путей `ICON` (совпадает с `Icon.tsx`), классы `m-stroke-*`.
- Заменены все текстовые глифы в моках: поиск терминала (chevron-up/down), SFTP (folder/file/upload/download),
  полный экран VNC (expand), шаги диагностики (arrow-down), финальная галочка (check).
- `IconPath`: тип `d` расширен до `string | readonly string[]`.
- `index.ts`: смоук иконок дополнен проверкой справки (`help=1`).

## Файлы

- `src/renderer/src/components/dialogs/helpContent.tsx`
- `src/main/index.ts`
