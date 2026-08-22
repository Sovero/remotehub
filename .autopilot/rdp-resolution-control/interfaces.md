# Интерфейсы (что изменил полёт rdp-resolution-control)

## Поведение

- Встроенная RDP-вкладка: тулбар над рабочим столом —
  - **выбор разрешения** (1024×768 … 1920×1080 + текущее): сохраняет width/height в профиль
    и переподключает сессию;
  - **«⛶ Полный экран»**: сохраняет `screenMode: 'fullscreen'`, переподключает — mstsc
    открывается отдельным полноэкранным окном, вкладка показывает фолбэк.
- Фолбэк: **«Встроить во вкладку»** возвращает `screenMode: 'window'` и сессию во встроенный
  режим (скрыта для multiMonitor-профилей) + тот же выбор разрешения.
- Полноэкранный mstsc (mode=window) теперь отслеживается менеджером и закрывается при
  закрытии вкладки/приложения (раньше оставался жить).

## Изменённые файлы

- `src/renderer/src/store.ts` — `relaunchRdp(sessionId, rdpPatch)`
- `src/renderer/src/App.tsx` — RdpPane: тулбар, `rdp-stage` (новый целевой rect), фолбэк
- `src/renderer/src/styles/global.css` — `.rdp-toolbar`, `.rdp-stage`, `.rdp-controls`, `.rdp-control`
- `src/renderer/src/components/dialogs/helpContent.tsx` — абзац о разрешении в справке RDP
- `src/main/rdp/manager.ts` — `launchWindowed`, `trackChild`; `stop()` убивает window-режим сразу
- `tests/rdp-embed.test.ts` — фолбэк-тесты, новый тест kill при stop
- `src/main/index.ts` — смоук `RH_SMOKE_RDP_RESOLUTION`

## Контракт для следующих тикетов

- `RdpManager.launch()` — оба режима (embedded/window) идут через `spawnImpl`; `legacyLaunch`
  убран из deps. `RdpLaunchOutcome.mode` по-прежнему 'embedded' | 'window'.
- `relaunchRdp(sessionId, patch: Partial<RdpOptions>)` — патч применяется к профилю в дереве,
  сохраняется и сессия переподключается (reconnectTab). Шаблон для будущих «быстрых» настроек.
- Смоук: `RH_SMOKE_RDP_RESOLUTION=1` (нужен `RH_SMOKE=1 RH_EXPECT_HOSTS=1`) — цикл
  окно → полный экран → окно → смена разрешения; вывод `[smoke] rdp resolution OK — …`.
- Сеид RDP-профиля: `.freebuff/seed-rdp-userdata.cjs <dir> <port>`.
