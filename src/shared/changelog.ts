/**
 * Парсер CHANGELOG.md в формате Keep a Changelog.
 *
 * Структура файла:
 *   ## [0.1.1] — 2026-08-23
 *   ### Добавлено
 *   - пункт
 *   ### Исправлено
 *   - пункт
 *
 * Парсер не зависит от Electron и покрыт юнит-тестами.
 */

export interface ChangelogSection {
  /** Заголовок секции (Добавлено / Исправлено / …). */
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  /** Версия без квадратных скобок: 0.1.1 */
  version: string;
  date?: string;
  sections: ChangelogSection[];
}

const HEADER_RE = /^##\s+\[([^\]]+)\](?:\s*—?\s*([^\n]*))?$/i;
const SECTION_RE = /^###\s+(.+)$/i;
const ITEM_RE = /^\s*[-*]\s+(.+)$/;

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let currentSection: ChangelogSection | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = line.match(HEADER_RE);
    if (header) {
      current = {
        version: header[1].trim(),
        date: header[2]?.trim() || undefined,
        sections: []
      };
      currentSection = null;
      entries.push(current);
      continue;
    }

    const section = line.match(SECTION_RE);
    if (section) {
      if (!current) continue; // секция вне версии — игнорируем
      currentSection = { title: section[1].trim(), items: [] };
      current.sections.push(currentSection);
      continue;
    }

    const item = line.match(ITEM_RE);
    if (item && currentSection) {
      currentSection.items.push(item[1].trim());
    }
  }

  return entries;
}

/** Ищет запись по версии; если не найдена — возвращает самую свежую (первую). */
export function findChangelogEntry(
  entries: ChangelogEntry[],
  version: string
): ChangelogEntry | null {
  if (entries.length === 0) return null;
  return entries.find((e) => e.version === version) ?? entries[0];
}
