# T01: Переключатель авто-подтверждения сертификата RDP

**Требования:** R01, R01.1, A01

**Суть:** настройка «Авто-подтверждать сертификат RDP» (по умолчанию вкл). При выкл.
предупреждение безопасности mstsc показывается пользователю, и он решает сам. Решение о
подтверждении перенесено целиком в менеджер (движок больше не гасит диалог при поиске окна).

**Файлы:**
- `src/shared/types.ts` — `rdpAutoAcceptCert` в `Settings` + `DEFAULT_SETTINGS`
- `src/renderer/src/components/SettingsForm.tsx` — чекбокс + hint
- `src/renderer/src/store.ts` — поле в стартовых настройках
- `src/main/rdp/manager.ts` — флаг, `setAutoAcceptCert()`, confirm под флагом в `attachWindow`/`tick`
- `src/main/rdp/win32-engine.ts` — убран авто-confirm из `findWindowByPid`
- `src/main/ipc.ts` — проброс настройки в менеджер
- `src/main/index.ts` — начальное значение + смоук `RH_RDP_AUTO_ACCEPT=0`
- `tests/rdp-embed.test.ts` — тест выключенного авто-подтверждения

**Приёмка:** смоук обеих веток против живого RDP-сервера (dev и packaged):
«предупреждение погашено» (вкл) / «предупреждение показано пользователю» (выкл);
101/101 тестов; typecheck чист.
