# Interfaces — что изменилось для следующих тикетов

## Новые файлы

- `CHANGELOG.md` — корень проекта, формат Keep a Changelog. Включён в релизную
  сборку (`files` в package.json). Новые версии: добавлять запись `## [x.y.z] — дата`
  с секциями `### …` и пунктами `- …` — попадает в «О программе» автоматически.
- `src/shared/changelog.ts` — `parseChangelog(markdown): ChangelogEntry[]`,
  `findChangelogEntry(entries, version)`; `ChangelogEntry { version, date?, sections[] }`,
  `ChangelogSection { title, items[] }`.

## IPC

- `IPC.appChangelog = 'app:changelog'` → `window.api.getChangelog()`:
  `{ ok, entries?: ChangelogEntry[], error? }`. Читает `CHANGELOG.md` от `__dirname`
  (работает в dev, смоуке и внутри asar).

## UI

- `DialogState` получил тип `{ type: 'about' }`; рендерится в DialogRoot.
- `AboutDialog` (Modal, ширина 460): логотип, версия/Electron/arch, changelog.
- `.statusbar-version` — кнопка версии в статусбаре (иконка `window`).
