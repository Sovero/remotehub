# Remote Hub v0.1.32 — первый canary-релиз

Notes mirror the CHANGELOG (Keep a Changelog). This is the **first release
through the draft-canary pipeline**: it went out as a draft (invisible to
electron-updater) and is published only after pilot verification.

## [0.1.32] — 2026-09-06

Ветка 0.1.32–0.1.34 велась dev-вишкой без выпуска; для первого
canary-релиза консолидирована в 0.1.32.

### Добавлено
- **Canary-контур релизов** — первый шаг staged rollout
  (`docs/canary-process.md`, §7 release-playbook):
  - `release.yml` создаёт релиз **черновиком** (`draft: true`,
    `make_latest: "false"`) — electron-updater не видит draft-релизы, поэтому
    автобновление никому не прилетает до явной публикации; ассеты и latest.yml
    при этом уже в draft, в step summary CI печатает дальнейшие шаги;
  - `scripts/canary-publish.mjs` — read-only верификация draft (ассеты,
    версия в latest.yml, sha512 base64 vs фактически скачанный exe — та же
    сверка, что делает electron-updater) и публикация одной командой с
    `--publish` и опциональной заменой notes (`--notes`); всё через `gh`
    без shell;
  - чек-лист пилота и роли мейнтейнера/пилотов — в `docs/canary-process.md`;
    откат на canary-этапе тривиален (draft просто удаляется).
- **Единая точка жизненного цикла RDP-движков** — `RdpEngineHub` подключён
  к IPC (фаза 1 плана вывода rdpjs из эксплуатации, риск R6):
  - все launch-пути (`rdpjsLaunch`, `ironStart`, `rdpLegacyLaunch`) идут через
    `hub.connect`; успех фиксирует владельца сессии;
  - close (`rdpjsClose`, `ironStop`, `rdpLegacyStop`, `sessionClose`) закрывает
    **ровно** движок-владелец — раньше `sessionClose` дёргал disconnect всех
    трёх движков подряд на каждую сессию (латентный кросс-движковый баг);
  - ввод мыши/клавиатуры и оконные команды (rect/activate/hide/overlay)
    маршрутизируются по capability-флагам движка;
  - `before-quit` закрывает все движки через `hub.closeAll()`;
  - новый единый канал состояний `rdp:engine-state` (payload с `engine` и
    фазой) транслируется в renderer (`window.api.onRdpEngineState`) и уже
    обрабатывается наряду со старыми `rdpjs:state`/`rdp-legacy:exited`
    (сами старые каналы снимутся в фазе 3 плана);
  - 13 новых тестов хаба: атрибуция владельцев, capability-маршрутизация,
    перевод событий (выход COM-host → error/disconnected, сторож моста iron),
    no-op повторного закрытия мёртвой сессии, closeAll.
