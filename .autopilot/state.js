window.STATE = {
  "slug": "audit-remediation", "title": "Устранение находок аудита Remote Hub", "mode": "full", "depth": "deep", "tier": "T2", "startedAt": "2026-08-27T09:40:00+03:00", "updatedAt": "2026-08-27T11:58:00+03:00", "finishedAt": "2026-08-27T11:58:00+03:00",
  "requirements": { "total": 12, "done": 12, "inTicket": 0, "inSpec": 0, "placeholder": 0, "deferred": 1, "dropped": 0 },
  "tickets": [
    { "id": "01", "title": "Проверка host key при SSH-подключении", "requirements": ["R01", "R01i.1", "R01i.2", "R01.1"], "blockedBy": [], "wave": 1, "status": "done", "startedAt": "2026-08-27T10:22:00+03:00", "finishedAt": "2026-08-27T10:47:00+03:00", "retries": 0, "files": ["src/main/sessions/host-keys.ts", "tests/host-keys.test.ts", "src/main/sessions/ssh-session.ts", "src/main/sessions/config.ts", "src/main/sessions/manager.ts", "src/main/ipc.ts", "src/main/index.ts", "src/shared/ipc-contract.ts", "src/preload/index.ts", "src/renderer/src/store.ts", "src/renderer/src/components/dialogs/PasswordDialog.tsx", "tests/session-integration.test.ts"], "tests": { "passed": 151, "failed": 0, "skipped": 2 }, "commit": "2d5ef87", "concerns": ["IPv6-литералы хоста не поддержаны схемой detail-строки (не требовалось depth pass'ом)", "субагент попутно создал мусорные файлы (пустые артефакты, REMOTE-HUB-AGENT-PROMPT.md) — удалены оркестратором до коммита, в коммит не попали"] },
    { "id": "02", "title": "Удаление неиспользуемого COM-хоста RDP", "requirements": ["R02"], "blockedBy": [], "wave": 1, "status": "done", "startedAt": "2026-08-27T10:47:00+03:00", "finishedAt": "2026-08-27T11:12:00+03:00", "retries": 0, "files": ["src/main/rdp/manager.ts (del)", "src/main/rdp/com-launcher.ts (del)", "src/main/rdp/win32-engine.ts (del)", "src/main/rdp/embed.ts (del)", "src/main/rdp/launcher.ts (del)", "src/main/rdp/generator.ts (del)", "src/native/ (del)", "scripts/build-com-host.cmd (del)", "build-com-host.bat (del)", "tests/rdp.test.ts (del)", "tests/rdp-embed.test.ts (del)", "tests/rdp-com-host.test.ts (del)", "package.json", "package-lock.json", "src/shared/ipc-contract.ts", "src/main/ipc.ts", "src/main/index.ts", "src/preload/index.ts", "src/renderer/src/store.ts", "src/renderer/src/App.tsx"], "tests": { "passed": 134, "failed": 0, "skipped": 2 }, "commit": "b606cfd", "concerns": ["Settings.rdpAutoAcceptCert остался в схеме и в SettingsForm.tsx как осиротевший no-op чекбоз — вне рамок тикета (схема настроек не менялась), вынесено в финальный отчёт"] },
    { "id": "03", "title": "Разгрузка main/index.ts и откат мёртвой правки сборки", "requirements": ["R03", "R03i.1", "R04"], "blockedBy": ["02"], "wave": 2, "status": "done", "startedAt": "2026-08-27T11:12:00+03:00", "finishedAt": "2026-08-27T11:40:00+03:00", "retries": 0, "files": ["src/main/index.ts (2125→389 строк)", "src/main/smoke/index.ts", "src/main/smoke/capture-help.ts", "src/main/smoke/rdp-flows.ts", "src/main/smoke/vnc-sftp.ts", "src/main/smoke/ui-icons.ts", "src/main/smoke/ui-update-contrast.ts", "src/main/smoke/ui-screenshot.ts", "src/main/smoke/ui-flows.ts", "electron.vite.config.ts (откат до HEAD)"], "tests": { "passed": 134, "failed": 0, "skipped": 2 }, "commit": "afe9ade", "concerns": [] },
    { "id": "04", "title": "Поиск, фильтр по источнику и экспорт в журнале событий", "requirements": ["R05.1", "R05.2", "R05.3", "R05.4", "R05.5"], "blockedBy": [], "wave": 1, "status": "done", "startedAt": "2026-08-27T11:40:00+03:00", "finishedAt": "2026-08-27T11:53:00+03:00", "retries": 0, "files": ["src/main/ipc.ts", "src/preload/index.ts", "src/renderer/src/components/dialogs/LogDialog.tsx", "src/renderer/src/styles/global.css", "src/shared/ipc-contract.ts", "tests/log.test.ts"], "tests": { "passed": 137, "failed": 0, "skipped": 2 }, "commit": "9b1b62f", "concerns": [] }
  ],
  "debt": { "placeholders": [], "assumptions": ["ASSUMPTION-1: COM-хост/MsRdpClient9 удаляется целиком, а не остаётся fallback-движком (spec §2)", "ASSUMPTION-2: незакоммиченная правка electron.vite.config.ts откатывается, а не достраивается (spec §4)"], "emptyEnv": [] },
  "additions": [],
  "blind": {
    "checkedAt": "2026-08-27T11:58:00+03:00",
    "agreedWithManifest": 5,
    "drift": 0,
    "notes": [
      "R05.5: слепая проверка отметила, что рендер-лимит (filtered.slice(-300) + баннер) — не буквально «виртуализация», а хвостовая обрезка списка; это осознанная замена из spec §5 (заводить windowing-библиотеку ради одного диалога признано непропорциональным), не расхождение по сути требования.",
      "R06 (deferred) подтверждён блайндом как «не реализовано» — ожидаемо, это не входило в тикеты этого захода."
    ]
  },
  "stages": [
    { "id": "preflight", "status": "done", "note": ".autopilot уже существовал в репозитории — переиспользован", "startedAt": "2026-08-27T09:40:00+03:00", "finishedAt": "2026-08-27T09:40:00+03:00" },
    { "id": "manifest", "status": "done", "startedAt": "2026-08-27T09:40:00+03:00", "finishedAt": "2026-08-27T09:55:00+03:00" },
    { "id": "briefing", "status": "skipped", "note": "полный автомат — самобрифинг, решения записаны как ASSUMPTION в manifest.md", "startedAt": "2026-08-27T09:55:00+03:00", "finishedAt": "2026-08-27T09:55:00+03:00" },
    { "id": "spec", "status": "done", "startedAt": "2026-08-27T09:55:00+03:00", "finishedAt": "2026-08-27T10:15:00+03:00" },
    { "id": "plan", "status": "done", "note": "T2 — 4 тикета, тикет 03 заблокирован тикетом 02", "startedAt": "2026-08-27T10:15:00+03:00", "finishedAt": "2026-08-27T10:22:00+03:00" },
    { "id": "build", "status": "done", "note": "4/4 тикета done, каждый — review+typecheck+tests+build оркестратором перед коммитом", "startedAt": "2026-08-27T10:22:00+03:00", "finishedAt": "2026-08-27T11:53:00+03:00" },
    { "id": "review", "status": "done", "note": "ревью по 3 осям на каждый тикет (см. concerns); полный npm test/typecheck/build зелёные после каждого", "startedAt": "2026-08-27T10:22:00+03:00", "finishedAt": "2026-08-27T11:53:00+03:00" },
    { "id": "final", "status": "done", "note": "слепая приёмка: 5/5 согласны с манифестом, 0 расхождений; R06 подтверждён как отложенный, ожидаемо", "startedAt": "2026-08-27T11:53:00+03:00", "finishedAt": "2026-08-27T11:58:00+03:00" }
  ]
};
