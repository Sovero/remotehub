# 02 — Удаление неиспользуемого COM-хоста RDP (MsRdpClient9)

**Требования:** R02
**Blocked by:** нет
**Status:** ready

## Что должно заработать

Ничего не меняется для пользователя — `RdpEngine` уже только `'iron' |
'rdpjs'`, и `window.api.rdpLaunch` нигде не вызывается из renderer (проверено
чтением `store.ts`/`App.tsx` в ходе аудита). Меняется кодовая база: путь
через `rdp-com-host.exe`/ActiveX `MsRdpClient9` удаляется целиком — файлы,
IPC-каналы, запись в инсталляторе, тесты. После удаления сборка, тесты и
typecheck остаются зелёными, IronRDP (по умолчанию) и rdpjs (легаси)
работают как прежде.

## Из брифа, дословно

> «Мёртвый путь: COM-хост / MsRdpClient9 ActiveX всё ещё в проекте, но не
> вызывается из UI... Код остаётся в бандле, в extraResources (packaged в
> инсталлятор), покрыт тестами, но недостижим из интерфейса.»

**ASSUMPTION-1** (из спеки §2, дословно): «путь удаляется целиком, а не
переводится в третий вариант `RdpEngine`» — исходное ТЗ проекта прямо
называет отказ от mstsc/MsTscAx/COM целью проекта, а не только выбором по
умолчанию.

## Разделы спеки

История 5, Решения §2 (полный список файлов на удаление), Швы —
существующий набор проверок + `grep` на отсутствие ссылок.

## Что удалить (полный список из Решений §2)

- `src/main/rdp/manager.ts`, `com-launcher.ts`, `win32-engine.ts`,
  `embed.ts`, `launcher.ts`, `generator.ts`
- `src/native/` целиком
- `scripts/build-com-host.cmd`
- запись `extraResources` в `package.json` (ключ `rdp-com-host.exe`)
- IPC: `rdpLaunch`, `rdpExited`, `rdpCertificate`, `rdpCertificateAccept`,
  `rdpCertificateReject`, `rdpRect`, `rdpActivate`, `rdpOverlay` — везде:
  `shared/ipc-contract.ts`, обработчики в `src/main/ipc.ts`, методы в
  `src/preload/index.ts` и `src/preload/index.d.ts`
- в `src/main/index.ts`: ветки `process.env.RH_SMOKE_RDP_EMBED` и
  `process.env.RH_SMOKE_RDP` (не путать с `RH_SMOKE_RDP_IRON` и
  `RH_SMOKE_RDP_RESOLUTION` — те остаются, они про iron/rdpjs)
- `tests/rdp.test.ts`, `tests/rdp-embed.test.ts`, `tests/rdp-com-host.test.ts`

## Не трогать

`shared/types.ts` (`RdpEngine` уже верный), `.rdp-pane`/`.rdp-pane--embedded`
в `App.tsx` (общая обёртка для iron/rdpjs, проверено — к COM-пути отношения
не имеет), `tests/rdp-iron-e2e.test.ts`, `tests/iron-gateway.test.ts`,
`tests/iron-probe.test.ts`, `src/main/rdp/iron-gateway.ts`,
`src/main/rdp/iron-sessions.ts`, `src/main/rdp/rdpjs-client.ts`.

Перед началом — свежий `git status`: `src/native/rdp-com-host.obj` уже в
`.gitignore`, но `.exe` и `.cpp`/`binding.gyp` закоммичены в HEAD и попадут
в diff удаления как обычные файлы.

## Критерии приёмки

- [ ] Ни одного упоминания `rdp-com-host`, `MsRdpClient`, `RdpManager`,
      `RdpComSpawn` в `src/`, `scripts/`, `package.json`, `tests/` (кроме
      `.autopilot/` и предыдущего отчёта аудита)
- [ ] `npm run typecheck && npx vitest run && npm run build` зелёные
- [ ] `package.json` не содержит `extraResources` записи про
      `rdp-com-host.exe`
- [ ] IronRDP (`rdpEngine: 'iron'`) и rdpjs (`rdpEngine: 'rdpjs'`) в
      `store.ts`/`App.tsx` не изменили поведение (diff их не касается)
