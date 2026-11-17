# T03 — Вставка из локального буфера в сессию IronRDP

**Требования:** R04

## Что сделано

- `src/renderer/src/components/IronRdpView.tsx`
  - `pushLocalClipboard(text, force)` — `session.onClipboardPaste(new Backend.ClipboardData())`
    с `addText('text/plain', …)`; без `force` повторная отправка того же текста не делается.
  - `sb.forceClipboardUpdateCallback(...)` — ответ на запрос буфера от сервера (момент
    вставки в удалённом приложении), отправляется актуальный локальный текст.
  - Опрос локального буфера каждые 700 мс через IPC-чтение из main, только при
    `document.hasFocus()`.
  - Ctrl+V в панели сессии: `preventDefault`, push текста на сервер и сканкоды
    `Ctrl (0x1d)` + `V (0x2f)` press/release в одной `InputTransaction`.
  - Защита от эха: `clipboardReceivedRef` / `clipboardSentRef`; текст с сервера обратно
    не отправляется.
- `src/renderer/src/lib/clipboard.ts` — используется существующий `readClipboardText()`.

Копирование с сервера (`remoteClipboardChangedCallback`, R01) не менялось, кроме
простановки отметки о полученном тексте.

## Приёмка

- `npx tsc --noEmit` (node + web) — чисто.
- `npx vitest run` — 24 файла passed / 1 skipped; 238 тестов passed / 2 skipped.
- Вживую не проверялось: нужен живой RDP-хост (проверить Ctrl+V в блокноте удалённого
  стола, копирование с сервера и отсутствие эха).
