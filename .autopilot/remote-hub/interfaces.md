# Что уже построено

Читается каждым исполнителем до начала работы. Не изобретай заново то, что здесь есть.

## Общие правила проекта

- Стек: Electron 43 + electron-vite 5 + React 19 + TypeScript 7 + zustand 5 + vitest 4.
- Команды: `npm run dev` (запуск), `npm run typecheck` (оба tsconfig), `npm test` (vitest run), `npm run build`, `npm run dist` (установщик NSIS).
- Тесты — только на швах из спеки: `tests/*.test.ts`, node-среда, алиас `@shared` → `src/shared`.
- Алиасы: `@shared` (всё), `@renderer` (только рендерер). Конфиги: `electron.vite.config.ts`, `tsconfig.node.json` (main/preload/shared), `tsconfig.web.json` (renderer).
- Запрещено менять без нужды: `src/shared/types.ts` (схема данных), `src/shared/ipc-contract.ts` (контракт IPC). Добавление каналов — да, изменение сигнатур существующих — только с согласованием.
- Не добавляй зависимости сам — если не хватает, верни BLOCKED с названием.
- Секреты: никогда не пишутся открытым текстом. Пароли — только через `sealSecret`/`unsealSecret` (`src/main/store/crypto-format.ts`).

## Из тикета 01 — каркас, оболочка, хранилище

- `Store` (`src/main/store/index.ts`): конструктор `new Store(dir, sealer)`. Методы: `loadProfiles()/saveProfiles(tree)`, `loadSettings()/saveSettings(settings)`, `loadCredentials()/saveCredentials(sets)`, `paths()`. Возвращают `{ data, recovered }`. Версия схемы — `SCHEMA_VERSION` (1); `SchemaTooNewError` при файле от более новой версии.
- `Sealer` (`src/main/store/crypto-format.ts`): `{ available(), seal(plain): Buffer, unseal(data): string }`. Формат: `sealSecret(plain, sealer)` → `enc:<base64>` или `plain:<base64>`, `unsealSecret(cipher, sealer)`. На Windows — `dpapiSealer` из `src/main/store/crypto.ts`.
- Модель данных (`src/shared/types.ts`): `TreeNode = Group | Host`, `Host.protocol: 'ssh'|'telnet'|'rdp'|'vnc'`, `CredentialSet`, `Settings`, фабрики `createHost/createGroup`, дефолты `DEFAULT_SETTINGS/DEFAULT_SSH/DEFAULT_RDP/DEFAULT_VNC`, `defaultPort(protocol)`.
- IPC (`src/shared/ipc-contract.ts`): константы каналов `IPC.*` + типы результата. В main — `registerIpc(store)` (`src/main/ipc.ts`). Preload — `window.api` (`src/preload/index.ts`), типы в `src/preload/index.d.ts` (глобальный `Window.api`).
- Рендерер: zustand-стор `useApp` (`src/renderer/src/store.ts`): `tree, settings, appInfo, ready, toasts`, методы `init/saveTree/patchSettings/pushToast/dismissToast`. Тосты — `pushToast(msg)`.
- Окно: `src/main/index.ts` — `createWindow()` в `app.whenReady`, single-instance, сохранение bounds в settings при resize/move (debounce 300ms).
- Уже реализованные IPC: `profiles:get/save`, `settings:get/set`, `credentials:list`, `app:info`, `app:notify` (рассылка тоста во все окна).

## Из тикета 02 — дерево профилей

- Чистые операции над деревом — `src/shared/tree.ts` (юнит-тесты в `tests/tree.test.ts`): `findNode`, `findParent`, `replaceNode`, `insertNode(tree, node, parentId|null)`, `removeNode`, `moveNode(tree, id, targetParentId, afterId?)` (с защитой от циклов), `filterTree`, `matchesHostQuery`, `collectTags`, `countHosts`, `duplicateHost`, `flattenHosts`, `buildExport`/`parseProfileExport`/`applyImport(current, incoming, 'merge'|'replace')`.
- IPC: `profiles:export` → `{ok, path?, canceled?, error?}`, `profiles:import` → `{ok, tree?, canceled?, error?}`. Диалоги файлов — в main (`dialog.showSaveDialog/OpenDialog`). Preload: `window.api.exportProfiles()/importProfiles()`.
- Рендерер: стор `useApp` получил диалоги (`dialog` + `openDialog/closeDialog`) и действия `upsertHost(host, parentId)`, `upsertGroup`, `deleteNode`, `toggleGroup`, `moveNode(id, targetParentId, afterId?)`, `duplicateNode`, `exportTree`, `importTree(mode)`.
- Компоненты: `TreeView` (строки `.tree-host`/`.tree-group`, drag&drop, `onMenu({x,y,node})`), `ContextMenu` (`items: MenuItem[]`), `DialogRoot` (рендерит активный диалог из стора), диалоги в `components/dialogs/` (`HostDialog` — поля всех протоколов, `GroupDialog`, `ConfirmDialog`, `ImportDialog`), `ProtocolIcon`.
- Валидация хоста: имя, адрес, порт 1–65535; для RDP-окна — разрешение ≥320×200. Ошибки — в `form-error`.
- Smoke-режим: `RH_SMOKE=1 npx electron .` — проверяет `window.__RH_READY__` и число `.tree-host` в DOM (`RH_EXPECT_HOSTS`), выходит с кодом 0/1. `RH_USER_DATA=<dir>` — свой userData для теста. Секретный путь: профили не содержат секретов; экспорт — тоже.
