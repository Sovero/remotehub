# T01: Управление разрешением встроенной RDP-сессии

**Требования:** R01, R01.1, R01.2, A01

**Суть:** во встроенной RDP-вкладке появляется тулбар: выбор разрешения (пресеты + текущее)
и кнопка «⛶ Полный экран». Выбор сохраняется в профиль и сессия переподключается. Полный
экран → отдельное полноэкранное окно mstsc + фолбэк с кнопкой «Встроить во вкладку».
Попутно унифицирован запуск фолбэка (mode=window) через spawnImpl + trackChild — теперь
полноэкранный mstsc закрывается при закрытии вкладки (раньше оставался жить).

**Файлы:**
- `src/renderer/src/store.ts` — `relaunchRdp(sessionId, rdpPatch)`
- `src/renderer/src/App.tsx` — RdpPane: тулбар, сцена (rdp-stage), фолбэк с «Встроить во вкладку»
- `src/renderer/src/styles/global.css` — стили тулбара/сцены/контролов
- `src/renderer/src/components/dialogs/helpContent.tsx` — упоминание в справке RDP
- `src/main/rdp/manager.ts` — `launchWindowed`, `trackChild`, stop() для window-режима
- `tests/rdp-embed.test.ts` — фолбэк-тесты + «полноэкранный mstsc убивается при закрытии вкладки»
- `src/main/index.ts` — смоук `RH_SMOKE_RDP_RESOLUTION`

**Приёмка:** смоук с реальным mstsc (живой порт 3389): «окно → полный экран → окно, разрешение
res=1024×768» в dev и packaged; 102/102 тестов; typecheck чист.
