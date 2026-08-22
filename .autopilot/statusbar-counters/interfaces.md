# Интерфейсы

## Счётчики строки статуса

- `Icon` (`Icon.tsx`) пополнен именами `tree` и `tab` — stroke-иконки дерева профилей и вкладки.
- `StatusBar` (`.statusbar-counters`) — группа из двух счётчиков: хостов (`flattenHosts(tree).length`)
  и активных сессий (фазы `connecting`/`connected`/`auth-required`), разделитель `.statusbar-divider`,
  тултип «Хостов: N · Активных сессий: M».
- Смоук: `RH_SMOKE_ICONS` проверяет счётчики и их значения (`counters=1`).
