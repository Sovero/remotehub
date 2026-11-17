# T04 — Замена сохранённого пароля, который не подошёл

**Требования:** R05

## Что сделано

- `src/main/sessions/manager.ts` — `storedPasswordUsed` (пароль взят из хранилища, а не из
  диалога) → состояние `auth-required` несёт `savedCredential: { id, name }`;
  `retryWithPassword(id, password, scope)` запоминает `pendingSave = { password, scope }` и
  вызывает `setPasswordSaver(host, password, scope)` только на фазе `connected`.
- `src/shared/ipc-contract.ts` — `PasswordSaveScope = 'none' | 'host' | 'credential'`,
  `SessionAuthRequest.password.saveScope`, `SessionState.auth-required.savedCredential`.
- `src/main/credentials/dto.ts` — `replaceablePasswordSet(credential, tree, hostId, scope)`:
  парольный набор (без ключа/агента); `'host'` — только если набор принадлежит ровно этому
  хосту; `'credential'` — набор обновляется целиком.
- `src/shared/tree.ts` — `credentialHostIds(tree, credentialId)` (перенесён из dto, нужен и
  renderer'у для счётчика хостов).
- `src/main/ipc.ts` — обновление набора на месте либо создание нового с привязкой к хосту;
  тосты «Пароль обновлён в наборе «…»» / «Пароль сохранён в новом наборе «…»».
- `src/renderer/src/store.ts` — в `applySessionState` считается `hostCount` и передаётся в
  диалог; `submitPassword(sessionId, password, saveScope)`.
- `PasswordDialog.tsx` — блок «Сохранённый пароль набора «X» не подошёл» + выбор
  «Все хосты набора (N)» / «Только этот хост» (второй — лишь при `hostCount > 1`).
- `tests/credentials.test.ts` — 5 тестов на `replaceablePasswordSet` (scope host/credential,
  общий набор, ключ/агент, чужой и отсутствующий набор).

## Приёмка

- `npx tsc --noEmit` (node + web) — чисто.
- `npx vitest run` — 24 файла passed / 1 skipped; 239 тестов passed / 2 skipped.
- Вживую не проверялось: нужен SSH-хост с парольной аутентификацией и заведомо устаревшим
  сохранённым паролем (проверить оба варианта scope и отсутствие новых наборов-дублей).
