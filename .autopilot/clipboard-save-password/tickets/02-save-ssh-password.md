# T02 — Сохранение пароля SSH

**Требования:** R02, A01

## Что сделано

- `src/renderer/src/components/dialogs/PasswordDialog.tsx` — чекбокс «Сохранить пароль»
  (включён по умолчанию); значение уходит в `submitPassword(sessionId, password, savePassword)`.
- `src/renderer/src/store.ts` — `submitPassword` с третьим аргументом; `App.tsx`
  подписан на `profiles:changed` → `setTree`.
- `src/shared/ipc-contract.ts` — `SessionAuthRequest.password.savePassword`, канал
  `profiles:changed`.
- `src/main/sessions/manager.ts` — `pendingSavePassword` + `setPasswordSaver`; запись
  выполняется в фазе `connected` (только после успешной аутентификации).
- `src/main/ipc.ts` — сохранение: обновление существующего набора (только если он
  принадлежит ровно этому хосту и вход по паролю) или создание нового набора
  с привязкой к хосту (`attachCredential`), рассылка дерева, тост пользователю.
- `src/main/credentials/dto.ts` — `attachCredential(tree, hostId, credentialId)`,
  `credentialHostIds`, `reusablePasswordSet` (общий набор и набор с ключом/агентом
  не перезаписываются — способ входа у остальных профилей не меняется).

## Приёмка

- `npm run typecheck` — чисто.
- `npm test` — 238 passed / 2 skipped (в `tests/log.test.ts` заглушка SessionManager
  получила no-op `setPasswordSaver`: `registerIpc` регистрирует обработчик сразу;
  в `tests/credentials.test.ts` — 4 теста на `reusablePasswordSet`: свой набор,
  общий набор, ключ/агент, чужой/отсутствующий набор).
- Вживую не проверялось: нужен SSH-хост с парольной аутентификацией.
