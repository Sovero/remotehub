# Что уже построено

Читается каждым исполнителем до начала работы. Не изобретай заново то, что здесь есть.

## Общие правила проекта

- Стек: Electron 43.4.0 + TypeScript + React 19 + electron-vite + Zustand + Vitest.
  Слои: `src/main` (Node), `src/preload` (contextBridge), `src/renderer/src`
  (React, без прямого доступа к Node), `src/shared` (типы + `ipc-contract.ts`).
- Команды: `npm run typecheck` (два прогона tsc — main и web конфиги),
  `npx vitest run` (весь набор), `npx vitest run tests/<file>.test.ts` (один
  файл), `npm run build` (electron-vite build → `out/`).
- `vitest.config.ts`: `environment: 'node'`, только `tests/**/*.test.ts`. В
  проекте **нет** jsdom/renderer test harness — компоненты `src/renderer/`
  не покрываются юнит-тестами; их проверяют вручную через `npm run dev` или
  через существующий паттерн `RH_SMOKE_*` в main-процессе.
- Секреты только через `Sealer`/`dpapiSealer` (`src/main/store/crypto.ts`,
  `crypto-format.ts`) — DPAPI на Windows, `plain:`-fallback только когда
  платформенное шифрование недоступно. Никогда не логировать пароли/
  passphrase/токены — журнал (`src/main/log.ts`) уже соблюдает это, не
  добавляй новых мест логирования секретов.
- IPC: имена каналов — только через `src/shared/ipc-contract.ts` (`IPC`
  map), никогда строкой напрямую. Новый канал = новая запись в `IPC`, новый
  тип запроса/ответа рядом, обработчик в `src/main/ipc.ts`, метод в
  `src/preload/index.ts` **и** `src/preload/index.d.ts` (оба поддерживаются
  вручную, не генерируются).
- Не менять: формат `Host`/`Settings`/`CredentialSet` в `src/shared/types.ts`
  (персистентные пользовательские данные — любое изменение поля требует
  миграции `SCHEMA_VERSION`, а это не входит ни в один тикет этого захода).
- Если для тикета не хватает npm-зависимости — не устанавливай сам, верни
  `BLOCKED` с названием пакета и зачем он нужен.
- Каждый тикет — один коммит. Сообщение коммита — на русском, в духе
  существующей истории (`git log --oneline`), с префиксом
  `fix:`/`refactor:`/`chore:` по смыслу изменения.

## Порядок и блокировки тикетов

01 (SSH host-key) и 02 (удаление COM-хоста) не блокируют друг друга по
файлам — выполняются один за другим (не параллельно) просто потому, что
исполнитель один и тот же поток работы. 03 **обязан** идти после 02: 03
переносит содержимое `src/main/index.ts`, а 02 удаляет из этого же файла
две smoke-ветки (`RH_SMOKE_RDP_EMBED`, `RH_SMOKE_RDP`) — если 03 стартует
раньше, перенос заденет код, которого уже не будет. 04 (LogDialog) не
зависит от 01/02/03 по требованиям, но трогает те же `shared/ipc-contract.ts`
и `src/preload/index.ts`, что и 02 — выполняется после 02, чтобы не
редактировать эти файлы одновременно с ним.

## Из тикета 01 — SSH host-key verification

- `HostKeyStore` (`src/main/sessions/host-keys.ts`): `new HostKeyStore(filePath)`;
  `isKnown(host, port)`, `get(host, port)`, `put(host, port, algo,
  fingerprint)`, `hasChanged(host, port, algo, fingerprint)`. Формат файла:
  `{ schemaVersion: 1, entries: { "<host>:<port>": { algo, fingerprint,
  firstSeenAt } } }`. `fingerprint` — base64 SHA256 хеш сырого wire-blob'а
  ключа, **без** префикса `SHA256:` (его добавляет только UI при отображении).
- `parseHostKey(keyBlob: Buffer) -> { algo, fingerprint }` — разбор SSH
  host key в wire-формате (то, что ssh2 передаёт в `hostVerifier`).
- `SshSession` (`src/main/sessions/ssh-session.ts`) — конструктор теперь
  `(config, cb, onAuthRequired, hostKeyStore, host, port)`. Новые методы:
  `handleHostKey(keyBlob, verify)` (точка входа ssh2 `hostVerifier`),
  `resolveHostKey(accept: boolean)` (ответ пользователя).
- `SessionManager` (`src/main/sessions/manager.ts`) — конструктор теперь
  `(sealer, send, hostKeyStore)`. Новый метод `resolveHostKey(id, accept)`.
- `SessionAuthRequest` (`shared/ipc-contract.ts`) — теперь объединение:
  `{ sessionId, password } | { sessionId, hostKeyDecision: 'accept' |
  'reject' }`. `window.api.sessionAuth(req)` принимает объект целиком (был
  `sessionAuth(sessionId, password)` — сигнатура изменилась, все места
  вызова обновлены).
- Формат `SessionState.detail` для host-key auth-required:
  `host-key:new:<host>:<port>:<algo>:<fingerprint>` или
  `host-key:changed:<host>:<port>:<algo>:<fingerprint>:<oldFingerprint>`.
  Разбирается в renderer через `parseHostKeyDetail(detail)` (экспортирован
  из `src/renderer/src/store.ts`) — не пиши свой парсер, если понадобится
  показать этот статус ещё где-то.
- `useApp().submitHostKeyDecision(sessionId, accept)` — новый экшен стора,
  вызывает `window.api.sessionAuth` с `hostKeyDecision`.
- Известное ограничение: разбор `detail`-строки предполагает, что `host` не
  содержит `:` — сырые IPv6-литералы этой схемой не поддерживаются (не
  требовалось depth pass'ом спеки, см. отчёт).

## Из тикета 02 — удаление COM-хоста

- `RdpManager`, `rdp-com-host.exe` и весь `src/native/` больше не существуют.
  `registerIpc(store, sessions, vnc, sftp, tunnels, updater, rdpjs)` — без
  `rdp`-параметра (был третьим). `createWindow()` — без аргументов (был
  `createWindow(rdp)`).
- IPC-каналы `rdpLaunch/rdpExited/rdpCertificate/rdpCertificateAccept/
  rdpCertificateReject/rdpRect/rdpActivate/rdpOverlay` удалены из `IPC`
  и из `window.api` — не используй их, если понадобится что-то похожее для
  iron/rdpjs, там уже есть свои каналы (`iron:*`, `rdpjs:*`).
- Зависимость `koffi`/`@koromix` удалена из `package.json` (была нужна
  только win32-embedding и smoke-проверке COM-пути) — не добавляй её
  обратно без явной необходимости.
- `Settings.rdpAutoAcceptCert` (shared/types.ts) **остался в типе и в
  SettingsForm.tsx** — сознательно не тронут (не входил в тикет, схема
  персистентных настроек — вне рамок этого захода), но теперь ни один
  движок (iron/rdpjs) его не читает: это осиротевший no-op чекбокс,
  вынесено в отчёт как остаточная находка, не мой тикет её чинить.

## Из тикета 03 — (заполняется после завершения)

## Из тикета 04 — (заполняется после завершения)
