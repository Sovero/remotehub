# T01: Иконки SFTP вместо текстовых глифов

## Требования
R01, R02, R03, R04, A01, A02

## Что сделать
1. `src/renderer/src/components/Icon.tsx` — иконка `file`.
2. `src/renderer/src/components/SftpPane.tsx` — иконки файла/папки в строках, направления передач, галочка завершения.
3. `src/renderer/src/styles/global.css` — `.sftp-ico` (inline-flex), `.sftp-op-name`/`.sftp-op-file` (inline-flex + ellipsis), `.sftp-op-meta`.
4. `src/main/ipc.ts` — в `sftpDownload` при `RH_SMOKE=1` сохранять в temp без диалога.
5. `src/main/index.ts` — смоук `RH_SMOKE_SFTP`.
6. `.freebuff/fake-sftp-server.cjs` (ssh2 Server, виртуальная ФС) + `.freebuff/seed-sftp-userdata.cjs`.

## Готово, когда
- `RH_SMOKE_SFTP` зелёный в dev и packaged: `ok:rows=3` (иконки файла/папки, направление, завершение).
- 107/107 тестов, typecheck чист, установщик пересобран.
