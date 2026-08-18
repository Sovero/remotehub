import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';

/**
 * Атомарная запись JSON: пишем во временный файл рядом, затем rename.
 * Читатель никогда не видит наполовину записанный файл.
 */
export function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, path);
}

export interface ReadJsonResult<T> {
  data: T | null;
  /** true, если файл существовал, но был повреждён и отложен в .bak */
  recovered: boolean;
  /** true, если файла не было вовсе (первый запуск) */
  missing: boolean;
}

/**
 * Чтение JSON с восстановлением: повреждённый файл переименовывается
 * в `<name>.bak-<timestamp>` и возвращается null вместо падения.
 */
export function readJsonSafe<T>(path: string): ReadJsonResult<T> {
  if (!existsSync(path)) {
    return { data: null, recovered: false, missing: true };
  }
  const raw = readFileSync(path, 'utf8');
  try {
    const parsed = JSON.parse(raw) as T;
    return { data: parsed, recovered: false, missing: false };
  } catch {
    const backup = `${path}.bak-${Date.now()}`;
    try {
      renameSync(path, backup);
    } catch {
      // Не смогли отложить повреждённый файл — оставляем как есть, но не падаем.
    }
    return { data: null, recovered: true, missing: false };
  }
}
