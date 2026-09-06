# Swarm-Advanced: паттерны оркестрации для Remote Hub

Практическое применение навыка `swarm-advanced` (claude-flow CLI, `npx claude-flow`,
v3.29.0) к этому репозиторию. MCP-инструменты (`mcp__claude-flow__*`) из примеров
навыка — эквиваленты CLI-команд: `agent_spawn` → `claude-flow agent`, `task_orchestrate`
→ `claude-flow task`, `parallel_execute` → `--parallel`.

Инициализированный рой: `swarm-1788469393464-2v8lep` (mesh, 6 агентов, adaptive) —
состояние в `.claude-flow/` (не коммитится). Запуск живых агентов (`swarm start`)
расходует квоту LLM — по умолчанию рой держится в dry-режиме.

## Выбор топологии под задачи проекта

| Топология  | Когда применять в Remote Hub |
|------------|------------------------------|
| `mesh`     | Исследование: сравнение RDP-движков (IronRDP vs node-rdpjs-2 vs MsTscAx), аудит зависимостей |
| `hierarchical` | Разработка фич, затрагивающих main+preload+renderer (контракт IPC тянет все три слоя) |
| `star`     | Прогон и валидация тестов (vitest, smoke-режимы `RH_SMOKE_*`) |
| `ring`     | Конвейер сборки: typecheck → build → подпись → обновление CHANGELOG |

## Паттерн 1: Research — аудит RDP-движков

Мультиагентный разбор трёх движков проекта перед архитектурными решениями.

```bash
npx claude-flow swarm "сравнить движки RDP: src/main/rdp/iron-gateway.ts (WASM),
src/main/rdp/rdpjs-client.ts (canvas), src/main/rdp/manager.ts + com-launcher.ts
(COM-host); критерии: безопасность, производительность, совместимость сертификатов" \
  --strategy research --mode distributed --max-agents 6 --parallel
```

Ожидаемые артефакты: карта рисков TLS-стеков (rustls vs SChannel vs собственный
стек node-rdpjs), узкие места рендеринга, рекомендации по дедупликации.

## Паттерн 2: Development — сквозная фича

Типовая фича здесь проходит все слои (см. RdpCanvas → preload → ipc.ts → main).
Иерархический рой распределяет слои по агентам, IPC-контракт (`src/shared/ipc-contract.ts`)
— точка синхронизации.

```bash
npx claude-flow swarm "добавить <фичу> по слоям: shared-контракт → preload →
main (src/main) → renderer (src/renderer/src/components)" \
  --strategy development --mode hierarchical --monitor
```

Воркфлоу с проверками из package.json:

| Фаза | Команда |
|------|---------|
| После правок типов | `npm run typecheck` |
| Юнит-тесты | `npm test` (vitest, 144+ теста) |
| Сборка | `npm run build` |
| E2E RDP (нужен живой хост) | `npm run test:e2e:rdp` |

## Паттерн 3: Testing — распределённый прогон

Звезда: координатор + параллельные исполнители тестовых групп.

```bash
npx claude-flow swarm "валидация: vitest run; smoke: scripts/smoke-rdp-iron.mjs" \
  --strategy testing --mode star --parallel --timeout 600
```

Группы тестов проекта: core (crypto, tree, store, log), протоколы (iron-gateway,
vnc-bridge, sftp-tunnels, session-integration), интеграция (host-keys, credentials,
updater, availability). Живые RDP/VNC-серверы в тестах не эмулируются — там, где
живая проверка невозможна, проверяется путь ошибки (см. docs/autopilot-runbook.md).

## Паттерн 4: Analysis — производительность и безопасность

```bash
# Профилирование канала RDP-рендеринга (main → IPC → canvas)
npx claude-flow swarm "найти узкие места: broadcast('rdpjs:bitmap') в src/main/index.ts,
конверсия BGRA→RGBA и rAF-батчинг в src/renderer/src/components/RdpCanvas.tsx" \
  --strategy analysis --mode mesh --max-agents 4

# Аудит безопасности зависимостей и секретов
npx claude-flow swarm "npm audit; поиск секретов; review DPAPI-хранилища (src/main/crypto)" \
  --strategy security --mode star
```

## Состояние, память, восстановление

```bash
npx claude-flow memory store --key rdp-audit --namespace research   # общий контекст агентов
npx claude-flow swarm status                                         # прогресс роя
npx claude-flow swarm stop                                           # остановка (dry-рой можно не останавливать)
```

Файлы `.claude-flow/` (daemon-state.json, swarm/, logs/, metrics/) локальные и
добавлены в `.gitignore`.

## Меры предосторожности

- `swarm start` запускает **живых** агентов с реальным расходом квоты LLM —
  для разминки использовать dry-инициализацию (`swarm init`).
- Пароли и креденшелы в аргументах оркестрации не передавать — они попадут в
  логи роя (`logs/`).
- Ограничение `--max-agents` держать ≤ 8: задачи репозитория распараллеливаются
  плохо (общие файлы: ipc-contract, store.ts), выигрыш даёт не количество
  агентов, а разнесение по слоям.
