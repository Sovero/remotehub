window.STATE = {
  "slug": "audit-remediation", "title": "Устранение находок аудита Remote Hub", "mode": "full", "depth": "deep", "tier": "T2", "startedAt": "2026-08-27T09:40:00+03:00", "updatedAt": "2026-08-27T11:12:00+03:00", "finishedAt": null,
  "requirements": { "total": 12, "done": 5, "inTicket": 7, "inSpec": 0, "placeholder": 0, "deferred": 1, "dropped": 0 },
  "tickets": [
    { "id": "01", "title": "Проверка host key при SSH-подключении", "requirements": ["R01", "R01i.1", "R01i.2", "R01.1"], "blockedBy": [], "wave": 1, "status": "done", "startedAt": "2026-08-27T10:22:00+03:00", "finishedAt": "2026-08-27T10:47:00+03:00", "retries": 0, "files": ["src/main/sessions/host-keys.ts", "tests/host-keys.test.ts", "src/main/sessions/ssh-session.ts", "src/main/sessions/config.ts", "src/main/sessions/manager.ts", "src/main/ipc.ts", "src/main/index.ts", "src/shared/ipc-contract.ts", "src/preload/index.ts", "src/renderer/src/store.ts", "src/renderer/src/components/dialogs/PasswordDialog.tsx", "tests/session-integration.test.ts"], "tests": { "passed": 151, "failed": 0, "skipped": 2 }, "commit": "2d5ef87", "concerns": ["IPv6-литералы хоста не поддержаны схемой detail-строки (не требовалось depth pass'ом)", "субагент попутно создал мусорные файлы (пустые артефакты, REMOTE-HUB-AGENT-PROMPT.md) — удалены оркестратором до коммита, в коммит не попали"] },
    { "id": "02", "title": "Удаление неиспользуемого COM-хоста RDP", "requirements": ["R02"], "blockedBy": [], "wave": 1, "status": "done", "startedAt": "2026-08-27T10:47:00+03:00", "finishedAt": "2026-08-27T11:12:00+03:00", "retries": 0, "files": ["src/main/rdp/manager.ts (del)", "src/main/rdp/com-launcher.ts (del)", "src/main/rdp/win32-engine.ts (del)", "src/main/rdp/embed.ts (del)", "src/main/rdp/launcher.ts (del)", "src/main/rdp/generator.ts (del)", "src/native/ (del)", "scripts/build-com-host.cmd (del)", "build-com-host.bat (del)", "tests/rdp.test.ts (del)", "tests/rdp-embed.test.ts (del)", "tests/rdp-com-host.test.ts (del)", "package.json", "package-lock.json", "src/shared/ipc-contract.ts", "src/main/ipc.ts", "src/main/index.ts", "src/preload/index.ts", "src/renderer/src/store.ts", "src/renderer/src/App.tsx"], "tests": { "passed": 134, "failed": 0, "skipped": 2 }, "commit": "b606cfd", "concerns": ["Settings.rdpAutoAcceptCert остался в схеме и в SettingsForm.tsx как осиротевший no-op чекбоз — вне рамок тикета (схема настроек не менялась), вынесено в финальный отчёт"] },
    { "id": "03", "title": "Разгрузка main/index.ts и откат мёртвой правки сборки", "requirements": ["R03", "R03i.1", "R04"], "blockedBy": ["02"], "wave": 2, "status": "pending", "startedAt": null, "finishedAt": null, "retries": 0, "files": [], "tests": null, "commit": null, "concerns": [] },
    { "id": "04", "title": "Поиск, фильтр по источнику и экспорт в журнале событий", "requirements": ["R05.1", "R05.2", "R05.3", "R05.4", "R05.5"], "blockedBy": [], "wave": 1, "status": "pending", "startedAt": null, "finishedAt": null, "retries": 0, "files": [], "tests": null, "commit": null, "concerns": [] }
  ],
  "debt": { "placeholders": [], "assumptions": ["ASSUMPTION-1: COM-хост/MsRdpClient9 удаляется целиком, а не остаётся fallback-движком (spec §2)", "ASSUMPTION-2: незакоммиченная правка electron.vite.config.ts откатывается, а не достраивается (spec §4)"], "emptyEnv": [] },
  "additions": [],
  "blind": null,
  "stages": [
    { "id": "preflight", "status": "done", "note": ".autopilot уже существовал в репозитории — переиспользован", "startedAt": "2026-08-27T09:40:00+03:00", "finishedAt": "2026-08-27T09:40:00+03:00" },
    { "id": "manifest", "status": "done", "startedAt": "2026-08-27T09:40:00+03:00", "finishedAt": "2026-08-27T09:55:00+03:00" },
    { "id": "briefing", "status": "skipped", "note": "полный автомат — самобрифинг, решения записаны как ASSUMPTION в manifest.md", "startedAt": "2026-08-27T09:55:00+03:00", "finishedAt": "2026-08-27T09:55:00+03:00" },
    { "id": "spec", "status": "done", "startedAt": "2026-08-27T09:55:00+03:00", "finishedAt": "2026-08-27T10:15:00+03:00" },
    { "id": "plan", "status": "done", "note": "T2 — 4 тикета, тикет 03 заблокирован тикетом 02", "startedAt": "2026-08-27T10:15:00+03:00", "finishedAt": "2026-08-27T10:22:00+03:00" },
    { "id": "build", "status": "active", "startedAt": "2026-08-27T10:22:00+03:00" },
    { "id": "review", "status": "pending" },
    { "id": "final", "status": "pending" }
  ]
};
