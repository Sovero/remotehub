# Что уже построено

Читается каждым исполнителем до начала работы. Не изобретай заново то, что здесь есть.

## Общие правила проекта

- Стек: Electron 43 + React 19 + TypeScript, electron-vite, vitest.
- Команды: `npm run typecheck`, `npm test` (один файл — `npm test -- <path>`), `npm run build`.
- Приложение Windows-only; RDP-сессии — нативный mstsc.exe + .rdp + cmdkey.
- Шифрование секретов — DPAPI через `safeStorage` (`src/main/store/crypto.ts`), не трогать.
- Смоук-режимы в `src/main/index.ts`: `RH_SMOKE=1` — общий фреймворк (гейт для всех RH_SMOKE_*,
  кроме RH_SMOKE_RDP_EMBED); `RH_FAKE_RDP=1` — имитация RDP без mstsc; `RH_USER_DATA` — свой каталог данных.
- События main → renderer через `broadcast`/`webContents.send`; контракт — `src/shared/ipc-contract.ts`.

## Из тикета 01 — встраивание RDP (main)

- `RdpManager` (src/main/rdp/manager.ts) — конструктор `new RdpManager({ sealer, send, getParentHwnd, engine?, spawn?, legacyLaunch?, watchdogInterval? })`.
  - `launch(host, credential, sessionId)` → `{ ok, mode: 'embedded'|'window', error? }` (может быть Promise).
  - `setRect(sessionId, rect)` — rect в **физических** пикселях относительно клиента окна (перевод CSS→физику делает ipc.ts по scaleFactor дисплея).
  - `activate(sessionId)` — показать встроенное окно сессии, спрятать остальные.
  - `setOverlay(boolean)` — прятать/возвращать встроенные окна при открытии модальных диалогов.
  - `stop(sessionId)` — WM_CLOSE + TerminateProcess через 3с (mstsc игнорирует WM_CLOSE на диалоге).
  - `isEmbedded(sessionId)` — для смоука.
- IPC-каналы (в `src/shared/ipc-contract.ts`): `rdp:rect` (send, `RdpRectRequest`), `rdp:activate` (send), `rdp:overlay` (send); `rdp:launch` → результат с `mode`.
- Win32-шов: `RdpEmbedEngine` (src/main/rdp/embed.ts) — `findWindowByPid`, `isWindow`, `embed`, `setRect`, `show`, `hide`, `setForeground`, `close`. Реализация на koffi — `win32-engine.ts` (грузится лениво, только win32). В тестах — фейк.
- Упаковка: koffi в `dependencies`, в `asarUnpack` добавлены `node_modules/koffi/**` и `node_modules/@koromix/**` (бинарник koffi 3.x лежит в `@koromix/koffi-win32-x64/win32_x64/koffi.node`).
- Тесты: `tests/rdp-embed.test.ts` (9) — фейковый движок/ребёнок; полный прогон 98.
- Смоук: `RH_SMOKE_RDP_EMBED=1` (без RH_SMOKE!) — реальный mstsc на мёртвый порт, проверка встраивания из main, exit 0.
