# Границы, решённые в спецификации

## Границы

| Модуль | Владеет | Выставляет | Прячет |
|--------|---------|------------|--------|
| RdpEngineHub | Атрибуция сессии движку и маршрутизация оконных команд | `connect/disconnect`, `setRect/activate/hide/setOverlay`, `engineOf` | Спавн процессов, stdin COM-хоста |
| RdpManager | Жизненный цикл COM-хоста и псевдо-встраивание | `launch/stop/setRect/activate/hide/setOverlay`, `isEmbedded` | Протокол stdin и Win32 SetWindowPos |
| LegacyRdpView | Геометрию сцены вкладки | Актуальный rect в CSS-пикселях | HWND, нативное окно и встраивание |
| Стор и политика | Решение об автопереходе на системный движок | `shouldAutoFallbackToLegacy`, `autoFallbackToLegacyRdp`, `rdpEngineAuto` на вкладке | Детали движков и IPC |
| Настройки | Включённость автоперехода | `Settings.rdpAutoFallbackToLegacy` (белый список в `ipc.settingsSet`) | Формат `settings.json` |

## Шов для тестов

Интерфейс движка встраивания (`LegacyEngineLike`) и внедряемый запуск COM-хоста (`comSpawn`). Через них проверяются:
маршрутизация оконных команд во время запуска, отмена запуска, встраивание с ранним rect — без живого RDP-сервера.
Политика автоперехода — чистая функция в `@shared/rdp-engine`, проверяется напрямую.

## Правила проекта

- Стек: Electron 43, electron-vite 5, TypeScript, React 19, Vitest 4, нативный C# COM-хост Windows (`rdp-com-host.exe`).
- Проверки: `npx vitest run tests/engine-hub.test.ts tests/quick-fixes.test.ts tests/rdp-fallback.test.ts tests/store.test.ts`,
  затем `npm run typecheck` и полный `npm test`.
- Зона прямой сборки T0: `src/main/rdp/engine-hub.ts`, `src/renderer/src/components/LegacyRdpView.tsx`,
  `src/shared/types.ts`, `src/shared/rdp-engine.ts`, `src/main/ipc.ts`, `src/renderer/src/store.ts`,
  `src/renderer/src/components/SettingsForm.tsx`, `src/renderer/src/components/StatusBar.tsx` и перечисленные тесты.
- Не менять без доказанной необходимости: `rdp-com-host.cs/.exe`, DPI-математику (`getParentOrigin`, `scaleFactor`),
  контракт IPC, схему профилей, зависимости и конфигурацию упаковки, поведение `rdpjs`-движка.
- Секреты — только через sealer, никогда открытым текстом. Тексты оверлея ошибки не переписывать.
- Нет нужного API или зависимости — вернуть `BLOCKED`, ничего не устанавливать.
