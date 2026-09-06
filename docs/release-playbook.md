# Release playbook — Remote Hub

Практический рецепт релиза этого репозитория, сверенный с реальным состоянием
`gh`, CI и скриптов 2026-09-06. Навык `github-release-management` описывает
общие паттерны; здесь они наложены на фактическую машину релизов remotehub —
включая то, что из навыка здесь **не работает**.

## 1. Как релизится этот репозиторий сегодня (проверено)

Релиз = **толчок тега**. Весь остальной конвейер автоматизирован.

```
git tag vX.Y.Z && git push origin vX.Y.Z
        │
        ▼
.github/workflows/release.yml  (windows-latest, on: push tags v*)
  ├─ npm install -g npm@11         # новый npm соблюдает allowScripts из package.json
  ├─ npm ci
  ├─ version from tag → package.json
  ├─ npx electron-builder install-app-deps   # пересборка нативных модулей под ABI Electron
  ├─ rm -rf node_modules/ssh2/lib/protocol/crypto/build   # см. большой комментарий в workflow
  ├─ npm run build
  ├─ npx electron-builder --win --x64 --publish never
  ├─ генерация release/latest.yml (sha512 base64, нормализованное имя ассета)
  └─ softprops/action-gh-release → публикует exe + latest.yml, generate_release_notes
```

Локальный путь `npm run dist` (для ручной сборки): `bump-version.mjs` (patch-бамп
в package.json) → `install-app-deps` → build → electron-builder --win --x64 →
`upload-latest-yml.mjs` (льёт latest.yml в существующий GitHub-релиз, если он уже
создан; молча пропускает, если релиза ещё нет).

Есть и `npm run dist:sign` — то же + `scripts/sign.mjs` (локальная подпись).

Автообновления: electron-updater по `publish: github Sovero/remotehub`;
`latest.yml` обязателен как ассет релиза — без него апдейтер не видит версию.

## 2. Что из навыка НЕ работает здесь (проверено 2026-09-06)

| Возможность навыка | Статус здесь |
|---|---|
| `npx claude-flow github <sub>` (release-create, changelog, …) | ❌ команды `github` нет в claude-flow v3.29.0 — весь семейство недоступно |
| `mcp__claude-flow__*` swarm-инструменты | ❌ не в тулсете сессии |
| `gh` CLI | ✅ v2.94.0, авторизован (Sovero, scope `repo`) |
| tag-push CI с win-сборкой | ✅ `.github/workflows/release.yml` |
| Многоцелевые деплои (npm publish, docker, s3) | ❌ не для этого продукта — это десктопное Electron-приложение; единственные «деплой-таргеты» — GitHub Release + electron-updater |
| Staged/canary rollout | ❌ electron-updater не умеет процентные раскатки; ближайший эквивалент — draft-релиз и ручная публикация |

Вывод: swarm-оркестрацию навыка заменяем тем, что реально есть — `gh` + git-теги
+ существующий CI; всё «дополнительно» из навыка (docker/npm/s3) для этого
продукта неприменимо.

## 3. Стандартный релиз (пошагово)

1. **Зелёное дерево.** `npm run typecheck && npm test` — сейчас 152 теста
   (18 файлов, 1 e2e под скипом без живого хоста). Релиз с красными тестами
   не выкатываем.
2. **CHANGELOG.** Верхняя секция `## [X.Y.Z] — дата` уже должна существовать
   (по конвенции репозитория она пишется вместе с изменениями; сегодня верх —
   `0.1.30`, а в package.json `0.1.19` — см. §4 о дрейфе).
3. **Сверка версии.** Убедиться, что версия в package.json ≥ последнего тега
   (см. §4). Для релиза `X.Y.Z` НЕ совпадающего с будущим bump — просто
   продолжаем: CI перезапишет версию из тега.
4. **Тег.** `git tag vX.Y.Z && git push origin vX.Y.Z`. Именно push тега —
   триггер. Аннотированный (`git tag -a`) тоже сработает.
5. **Наблюдение.** `gh run watch` (или вкладка Actions). Сборка ~5–10 мин.
6. **Проверка релиза.**
   `gh release view vX.Y.Z --repo Sovero/remotehub` — должны быть два ассета:
   `Remote.Hub.Setup.X.Y.Z.exe` и `latest.yml`. Убедиться, что в latest.yml
   `version: X.Y.Z` и sha512 совпадает с exe (апдейтер сверяет base64-дайджест).
7. **Notes.** CI создаёт релиз с `generate_release_notes: true` (авто-PR-list).
   При желании — `gh release edit vX.Y.Z --notes-file ...` с текстом из
   CHANGELOG-секции поверх автогенерации.

## 4. Ловушки этого репозитория (все — реальные)

- **Дрейф версии package.json vs CHANGELOG.** Сейчас package.json = `0.1.19`,
  CHANGELOG-верхушка = `0.1.30`, последний тег = `v0.1.28`. Причина: `dist`-путь
  бампает версию **локально перед сборкой**, но `bump-version.mjs` не коммитит —
  бампы «сгорают» в рабочем дереве. Для апдейтера важно только то, что CI
  записывает из тега, так что это не ломает обновления, но:
  - `git status` с «изменённым package.json» перед релизом — норма, не баг;
  - НЕ стоит «чинить» package.json вручную до произвольной версии — CI всё
    равно перезапишет из тега;
  - если хотите честный package.json — одна ручная синхронизация с последним
    тегом (или добавить в CI коммит бампа — но это уже изменение политики).
- **Бамп без коммита**: `npm run dist` поднимает версию, но не делает commit/tag —
  локальная сборка с непушенным тегом породит релиз, которого нет на GitHub.
- **`npm run dist` требует уже существующий релиз** для upload-latest-yml
  (скрипт молча пропускает, если релиза нет) — это не ошибка, это by design:
  локальная сборка обычно догоняет уже созданный CI-релиз.
- **latest.yml критичен**: без него апдейтер не видит новую версию. Если CI упал
  после сборки exe, но до release-шага — exe есть, обновления не будет.
- **ssh2 native-биндинг**: никогда не убирайте шаг `rm -rf node_modules/ssh2/...`
  из workflow — это фикс реальной поставки битых ABI (v0.1.15–v0.1.22).
- **Нормализация имён ассетов**: GitHub превращает пробелы в точки; latest.yml
  ссылается на `Remote.Hub.Setup.X.Y.Z.exe` (с точками) — скрипт в CI это уже
  учитывает; при ручной заливке не перепутайте имя.

## 5. Откат (реалистичный для этого продукта)

Полноценного auto-rollback у electron-updater нет. Практическая процедура:

1. Собрать/выбрать последний стабильный exe (например, из релиза v0.1.27).
2. `gh release create vBAD-fix --target main --notes "rollback to 0.1.27"` —
   «новая» версия с **бóльшим** номером, но со старым exe, чтобы апдейтер
   накатил её поверх битой. Либо — пересобрать тег `vX.Y.Z+1` на коммите
   предыдущего стабильного (см. пункт ниже).
3. Удалить битую версию из раздачи: `gh release edit vX.Y.Z --draft` (draft
   скрывает релиз и ассеты от апдейтера) или `gh release delete vX.Y.Z --yes`
   если версия никому не успела уйти.

## 6. Чек-лист релиза (применён к этому репо)

- [ ] typecheck + тесты зелёные
- [ ] CHANGELOG-секция `[X.Y.Z]` заполнена (ru, Keep-a-Changelog формат)
- [ ] версия ≥ последнего тега (или смирились с CI-перезаписью)
- [ ] тег `vX.Y.Z` запушен → CI зелёный
- [ ] у релиза 2 ассета: exe + latest.yml; `version:` в yml = X.Y.Z
- [ ] release notes: автогенерация или REPLACE из CHANGELOG-секции
- [ ] после релиза: `npm run smoke:rdp:iron` на живом хосте — можно и позже
- [ ] если релиз неудачный: draft/delete + откат по §5

## 7. Что из навыка можно взять на будущее (не сейчас)

- **draft-релиз как canary**: создать draft, отдать 1–2 пилотам, публиковать
  после подтверждения. Это единственная реалистичная «staged rollout» для
  electron-updater без изменения инфраструктуры.
- **changelog-агент**: `gh api repos/Sovero/remotehub/compare/vLAST...main
  --jq '.commits[].commit.message'` — полуфабрикат для ручного черновика
  CHANGELOG-секции (авто-категоризацию придётся делать руками или отдельным
  агентом — claude-flow github недоступен).
- **security-скан перед тегом**: `npm audit --audit-level=high` — дешёвая
  проверка, стоит добавить в чек-лист перед тегом (сейчас в CI его нет).
