# Интерфейсы (что изменил полёт rdp-cert-toggle)

## Поведение

- Новая настройка **«Авто-подтверждать сертификат RDP»** (`rdpAutoAcceptCert`, по умолчанию
  **вкл** — как раньше). Выкл: предупреждение безопасности mstsc (непроверенный сертификат)
  показывается пользователю при каждом подключении, и он жмёт «Подключить»/«Отмена» сам.
- Настройка применяется к живым сессиям без перезапуска (следующий тик сторожа).
- Авто-подтверждение теперь решает **менеджер**, а не движок: `findWindowByPid` больше не
  гасит диалог внутри себя.

## Изменённые файлы

- `src/shared/types.ts` — `rdpAutoAcceptCert: boolean` в `Settings` + `DEFAULT_SETTINGS`
- `src/renderer/src/components/SettingsForm.tsx` — чекбокс «Авто-подтверждать сертификат RDP»
- `src/renderer/src/store.ts` — поле в стартовых настройках
- `src/main/rdp/manager.ts` — `setAutoAcceptCert(value)`, confirm в `attachWindow`/`tick` под флагом
- `src/main/rdp/win32-engine.ts` — `findWindowByPid` не вызывает confirm (диалог по-прежнему
  исключается из кандидатов на встраивание)
- `src/main/ipc.ts` — `settings:set` → `rdp.setAutoAcceptCert(...)`
- `src/main/index.ts` — `RdpManager` инициализируется значением из хранилища; смоук
  `RH_SMOKE_RDP_EMBED` поддерживает `RH_RDP_AUTO_ACCEPT=0`
- `tests/rdp-embed.test.ts` — тест выключенного авто-подтверждения

## Контракт для следующих тикетов

- `RdpManagerDeps.autoAcceptCert?: boolean` (default true) — начальное значение.
- `RdpManager.setAutoAcceptCert(value: boolean)` — обновление на лету.
- Смоук: `RH_RDP_AUTO_ACCEPT=0` → ожидаем «предупреждение показано пользователю (видимых: N)»;
  иначе (или `1`) → «предупреждение безопасности погашено».
- Проба сидирования RDP-смоука: `.freebuff/seed-rdp-userdata.cjs <dir> <port>`.
