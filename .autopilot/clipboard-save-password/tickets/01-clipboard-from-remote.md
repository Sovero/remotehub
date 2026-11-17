# T01 — Копирование из сессии в буфер Windows

**Требования:** R01, R01.1

## Что сделано

- `src/renderer/src/components/IronRdpView.tsx` — `sb.remoteClipboardChangedCallback`:
  текст из буфера удалённого стола пишется в локальный буфер.
- `src/renderer/src/components/TerminalPane.tsx` — OSC 52 (`term.parser.registerOscHandler(52)`),
  копирование/вставка через IPC-буфер, ПКМ копирует выделение (нет выделения — вставка).
- `src/renderer/src/lib/clipboard.ts` — `copyTextToClipboard` / `readClipboardText`
  (нативный clipboard main, откат на `navigator.clipboard`).
- `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/preload/index.ts` —
  каналы `clipboard:write-text` / `clipboard:read-text`.

## Приёмка

- `npm run typecheck` — чисто.
- `npm test` — 234 passed / 2 skipped.
- Вживую не проверялось: нужен живой RDP-хост и tmux `set-clipboard on` на SSH-хосте.
