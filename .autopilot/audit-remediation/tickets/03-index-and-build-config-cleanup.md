# 03 — Разгрузка main/index.ts и откат мёртвой правки сборки

**Требования:** R03, R03i.1, R04
**Blocked by:** 02 (COM-путь и его smoke-ветки должны быть уже удалены из
`src/main/index.ts`, иначе перенос заденет код, которого больше не будет)
**Status:** ready

## Что должно заработать

`src/main/index.ts` укладывается в лимит проекта (< 500 строк, по факту
спека целится в < 300) и содержит только реальный запуск приложения:
single-instance lock, `app.whenReady`, создание окна, регистрация меню и
IPC, `before-quit`. Вся smoke-тестовая логика (ветки `RH_SMOKE_*`,
`RH_CAPTURE_HELP`) переезжает в `src/main/smoke/*.ts` дословно — то же
поведение, тот же результат при запуске `npm run dev`/CI-скриптов, просто
из других файлов. Отдельно — из `electron.vite.config.ts` убирается
незакоммиченная мёртвая правка (`__remoteHubNativeModules`), которая нигде
не читается.

## Из брифа, дословно

> «`src/main/index.ts` — 2125 строк, ~90% это встроенные smoke-тесты...
> Прямое нарушение правила проекта «Keep files under 500 lines» и смешение
> ответственности.»

> «Несогласованная (незакоммиченная) правка `electron.vite.config.ts`...
> мёртвый код, который ничего не чинит.»

**ASSUMPTION-2** (из спеки §4, дословно): «правка отменяется, а не
достраивается» — сборка уже работает без нее, переменная нигде не читается.

## Разделы спеки

История 6–7, Решения §3 и §4 (группировка модулей, список веток по темам).

## Как разбить (из Решений §3)

- `src/main/smoke/index.ts` — `installSmokeHooks(...)`, вызывается одной
  строкой из `index.ts` внутри `app.whenReady`, не срабатывает без
  `RH_SMOKE_*`/`RH_CAPTURE_HELP` в окружении.
- `src/main/smoke/ui-flows.ts` — `RH_SMOKE`, `RH_SMOKE_ICONS`,
  `RH_SMOKE_UPDATE`, `RH_SMOKE_CONTRAST`, `RH_SMOKE_SCREENSHOT` и связанные
  `RH_SHOT_*`.
- `src/main/smoke/rdp-flows.ts` — `RH_SMOKE_RDP_IRON`,
  `RH_SMOKE_RDP_RESOLUTION` (COM-специфичные ветки уже удалены тикетом 02 —
  сюда их не переносить).
- `src/main/smoke/vnc-sftp.ts` — `RH_SMOKE_VNC`, `RH_SMOKE_VNC_ERROR`,
  `RH_SMOKE_SFTP`.
- `src/main/smoke/capture-help.ts` — `RH_CAPTURE_HELP`.
- Перенос — копирование тела веток как есть, без переписывания логики;
  риск регрессии создаёт именно переписывание.
- `electron.vite.config.ts` — убрать блок `output.intro` с
  `__remoteHubNativeModules`, оставить `external: ['bufferutil',
  'utf-8-validate']` как было до незакоммиченной правки.

## Критерии приёмки

- [ ] `src/main/index.ts` < 500 строк
- [ ] Каждый новый модуль в `src/main/smoke/` < 500 строк
- [ ] `RH_SMOKE=1` и `RH_SMOKE_ICONS=1` дают тот же результат (лог/exit code),
      что и до переноса — прогнать до и после, сравнить
- [ ] `grep -r __remoteHubNativeModules src/ out/` — ноль совпадений
- [ ] `npm run typecheck && npx vitest run && npm run build` зелёные
