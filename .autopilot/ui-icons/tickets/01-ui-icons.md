# T01: Иконки для кнопок

**Требования:** R01, R01.1, R01.2, A01

**Суть:** добавить иконки всем видимым кнопкам интерфейса. Единый компонент `Icon`
(инлайн-SVG, без зависимостей), текст кнопок сохранён, стили согласованы.

**Файлы:**
- `src/renderer/src/components/Icon.tsx` — новый набор иконок
- `src/renderer/src/components/Sidebar.tsx`, `TabBar.tsx`, `SessionOverlay.tsx`,
  `App.tsx`, `VncViewer.tsx`, `SftpPane.tsx`, `TerminalPane.tsx`, `ContextMenu.tsx`,
  `Welcome.tsx`, `UpdateBar.tsx`, `InteractiveTour.tsx`
- `src/renderer/src/components/dialogs/*` — Modal, ConfirmDialog, GroupDialog, HostDialog,
  ImportDialog, PasswordDialog, CredentialsDialog, SnippetsDialog, HelpDialog,
  NewSessionDialog, TunnelsDialog
- `src/renderer/src/styles/global.css` — flex-кнопки, `.btn--icon`, `.ctxmenu-icon`, `.host-list-go`
- `src/main/index.ts` — смоук `RH_SMOKE_ICONS`

**Приёмка:** смоук `RH_SMOKE_ICONS` (footer=6, ctx=6, actions=2 — все с svg) в dev и packaged;
RDP-смоук разрешения и VNC happy-path зелёные; 107/107 тестов; typecheck чист.
