# T01: Понятные сообщения об ошибках в VNC-вкладке

**Требования:** R01, R02, R01.1, R01.2, A01, A02

**Суть:** noVNC не даёт внятных причин разрыва — мост теперь следит за RFB-рукопожатием
и шлёт в рендерер точное сообщение (молчащий сервер / не-RFB-ответ / неподдерживаемые
security-типы) по каналу `vnc:error`; вьювер страхует фолбэк-таймаутом. Попутно убран
скрытый баг `rfb.connect()` (метода нет в noVNC 1.7 — конструктор сам начинает
подключение), из-за которого каждая VNC-сессия молча падала в error.

**Файлы:**
- `src/main/vnc/bridge.ts` — `RfbHandshakeWatcher` (фазы версии/security, onError)
- `src/shared/ipc-contract.ts` — канал `vnc:error`
- `src/main/vnc/manager.ts`, `src/main/index.ts`, `src/preload/index.ts` — проброс канала
- `src/renderer/src/App.tsx` — слушатель `vnc:error` → фаза error вкладки
- `src/renderer/src/components/VncViewer.tsx` — фолбэк-таймаут 15 с; вызов `rfb.connect()` удалён
- `src/renderer/src/types/novnc.d.ts` — `connect()` убран из типов
- `tests/vnc-bridge.test.ts` — 4 теста вотчера
- `src/main/index.ts` — смоук `RH_SMOKE_VNC_ERROR`; `RH_SMOKE_VNC` усилен проверкой отсутствия оверлея
- `.freebuff/silent-tcp.cjs` — тихий TCP-сервер для смоука

**Приёмка:** смоук `RH_SMOKE_VNC_ERROR` (тихий сервер → «VNC-сервер не отвечает на
рукопожатие…») в dev и packaged; смоук `RH_SMOKE_VNC` (кадр отрисован, оверлея нет);
107/107 тестов; typecheck чист.
