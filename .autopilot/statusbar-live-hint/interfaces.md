# Интерфейсы

## Живая подсказка статусбара

- `StatusBar` (`.statusbar-live-hint`) — элемент статусбара для активной вкладки:
  VNC → `порт <N>` (иконка `link`, тултип «Локальный порт VNC-моста»);
  RDP → адрес сервера (иконка `host`, тултип «Адрес RDP-сервера»).
- Данные: `active.vnc.port` (мост VNC) и `findNode(tree, hostId)` / `adHocHost` (RDP).
- Смоуки: `RH_SMOKE_VNC` (`hint=` в выводе), `RH_SMOKE_ICONS` (`rdp-hint=1`).
