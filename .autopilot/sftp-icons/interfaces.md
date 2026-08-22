# Интерфейсы: иконки SFTP вместо текстовых глифов

## Icon.tsx
- Новое имя иконки: `'file'` (документ с загнутым углом). Уже есть: `folder`, `upload`, `download`, `check`.

## SftpPane / CSS
- Строка каталога: `.sftp-ico` (inline-flex, muted) + `.sftp-ico--dir` (warn) вокруг `<Icon name={isDir ? 'folder' : 'file'} size={12} />`.
- Передача: `.sftp-op-name` (inline-flex, gap 5px) = `<Icon name={upload|download} size={11}/>` + `.sftp-op-file` (ellipsis). `.sftp-op-meta` (inline-flex, gap 4px); завершение — `<Icon name="check" size={10}/>`.

## ipc.ts
- `sftpDownload` при `RH_SMOKE === '1'` пишет в `app.getPath('temp')/rh-sftp-dl-<nanoid>-<имя>` без нативного диалога.

## Смоук
- `RH_SMOKE_SFTP=1` (нужен запущенный `.freebuff/fake-sftp-server.cjs` и сид `seed-sftp-userdata.cjs <dir> <port>`):
  - открывает SFTP через контекстное меню; ждёт 3 строки в `.sftp-pane-col--remote .sftp-row`;
  - проверяет иконки папки/файла по `d`-атрибуту (folder `M2.2 4.2…`, file `M3.2 2.4…`);
  - двойной клик по файлу → строка передачи с download-иконкой (`M8 2.6…`) → `.sftp-op--done` с check (`M3 8.4…`).
  - Результат: `ok:rows=3`.
