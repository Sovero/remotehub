# T06 — Буфер обмена в VNC-сессиях

**Требования:** R07

## Что сделано

- `src/renderer/src/components/VncViewer.tsx`
  - `rfb.addEventListener('clipboard', …)` → `copyTextToClipboard(detail.text)` (VNC → локально).
  - `pushLocalClipboard(text)` → `rfb.clipboardPasteFrom(text)` (локально → VNC) без повторов;
    вызывается сразу после `connect` (чтобы первая вставка в удалённом приложении видела текст)
    и опросом локального буфера раз в 700 мс, только при `document.hasFocus()`.
  - `rfbRef` / `connectedRef` для доступа к живой сессии из опроса; на `disconnect` оба
    сбрасываются.
  - Защита от эха: `clipboardReceivedRef` / `clipboardSentRef` — текст с сервера обратно
    не отправляется.
- `src/renderer/src/types/novnc.d.ts` — объявлен `clipboardPasteFrom(text: string): void`
  (в noVNC 1.7 метод есть, но типы в проекте были минимальные).

## Приёмка

- `npx tsc --noEmit` (node + web) — чисто.
- `npx vitest run` — 24 файла passed / 1 skipped; 239 тестов passed / 2 skipped.
- Вживую не проверялось: нужен VNC-сервер. Проверить копирование внутри VNC-сессии,
  вставку в удалённое приложение после копирования в Windows, отсутствие эха и работу
  после переподключения. В легаси-протоколе без extended clipboard noVNC передаёт
  только ISO 8859-1 — не-ASCII символы могут искажаться.
