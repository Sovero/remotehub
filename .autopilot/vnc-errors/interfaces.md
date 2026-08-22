# Интерфейсы (что изменил полёт vnc-errors)

## Поведение

- VNC-вкладка при поломке подключения показывает внятный оверлей вместо вечного
  «Подключение…»: «VNC-сервер не отвечает на рукопожатие…», «На этом порту работает
  не VNC-сервер…», «VNC-сервер требует тип шифрования, который приложение не
  поддерживает (типы: …)…».
- Сообщение приходит из main мгновенно (мост видит байты рукопожатия); фолбэк-таймаут
  вкладки (15 с) срабатывает, только если мост по какой-то причине не ответил.
- VNC-сессия при живом сервере больше не падает в error с «rfb.connect is not a function»
  (вызов удалён; noVNC 1.7 сам начинает подключение в конструкторе).

## Изменённые файлы

- `src/main/vnc/bridge.ts` — класс `RfbHandshakeWatcher`, `startBridge(host, port, onError?, opts?)`.
- `src/shared/ipc-contract.ts` — канал `vnc:error` (`{ sessionId, message }`).
- `src/main/vnc/manager.ts`, `src/main/index.ts`, `src/preload/index.ts` — проброс канала.
- `src/renderer/src/App.tsx` — слушатель `vnc:error`.
- `src/renderer/src/components/VncViewer.tsx` — фолбэк-таймаут; удалён `rfb.connect()`.
- `src/renderer/src/types/novnc.d.ts` — из типов RFB убран `connect()`.
- `src/main/index.ts` — смоук `RH_SMOKE_VNC_ERROR`; `RH_SMOKE_VNC` проверяет отсутствие оверлея.

## Контракт для следующих тикетов

- `startBridge(host, port, onError?, { versionTimeoutMs? })` — третий аргумент — колбэк
  ошибки рукопожатия; вызывается ровно один раз, соединение при этом не рвётся.
- `RH_SMOKE_VNC_ERROR=1` — смоук: тихий TCP-сервер → оверлей с «не отвечает на рукопожатие».
- Проба молчащего сервера: `.freebuff/silent-tcp.cjs` (stdout: `READY <port>`).
