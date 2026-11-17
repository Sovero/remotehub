# T01 — Общая политика буфера обмена для SSH, RDP и VNC

**Требования:** R01, R02

## Что сделано

- `src/shared/clipboard-policy.ts` — общая логика: `ClipboardPolicy`,
  `clipboardDecision`, `clipboardPreview`, `dispatchRemoteCopy(policy, maxBytes,
  text, source, effects)`, `utf8Length`, `formatBytes`, `DEFAULT_CLIPBOARD_MAX_BYTES`.
- `src/shared/osc52.ts` — остался только `parseOsc52`: разбор последовательности
  отделён от решения о записи.
- `src/shared/types.ts` — `clipboardPolicy` / `clipboardMaxBytes` вместо `osc52*`.
- `src/main/store/index.ts` — миграция старых ключей `osc52Policy` / `osc52MaxBytes`
  в новые.
- `src/renderer/src/lib/remote-clipboard.ts` — `offerRemoteClipboard(text, source)`:
  единая точка для SSH, RDP и VNC.
- `src/renderer/src/lib/clipboard.ts` — `applyRemote` → `markRemote`: синхронизация
  только помечает пришедший текст, в буфер больше не пишет.
- `src/renderer/src/components/IronRdpView.tsx`, `VncViewer.tsx` — вызывают
  `markRemote` + `offerRemoteClipboard`; `TerminalPane.tsx` — OSC 52 через ту же
  функцию, локальная модалка и её состояние удалены.
- `src/renderer/src/components/dialogs/ClipboardAskDialog.tsx` — общий диалог
  подтверждения (источник, размер, предпросмотр), рендерится в `App`.
- `src/renderer/src/store.ts` — `pendingClipboard` + `setPendingClipboard`.
- `src/renderer/src/styles/global.css` — класс `.clip-preview` вместо инлайнового
  стиля в двух местах.
- `tests/clipboard-policy.test.ts` — решения политик, предел в байтах UTF-8,
  предпросмотр, `dispatchRemoteCopy` для `ask` / `allow` / `deny` / `too-large`
  с источником; `tests/osc52.test.ts` сокращён до разбора последовательностей.

## Приёмка

- `npx tsc --noEmit` (node + web) — чисто.
- `npx vitest run` — 26 файлов passed / 1 skipped, 257 тестов passed / 2 skipped.
- Вживую не проверялось: нужен живой RDP-хост и VNC-сервер (и окно приложения для
  диалога). Сценарии для ручной проверки — в `manifest.md`.
