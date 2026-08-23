import { describe, expect, it } from 'vitest';
import { findChangelogEntry, parseChangelog } from '../src/shared/changelog';

const SAMPLE = `# Changelog

## [0.1.1] — 2026-08-23

### Добавлено
- Правила версионирования билдов
- Живая подсказка активной вкладки

### Исправлено
- Контраст иконок в светлой теме

## [0.1.0] — 2026-08-22

### Добавлено
- SSH, Telnet, RDP, VNC и SFTP сессии
- RDP внутри приложения
`;

describe('parseChangelog', () => {
  it('разбирает версии, даты и секции', () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries).toHaveLength(2);
    expect(entries[0].version).toBe('0.1.1');
    expect(entries[0].date).toBe('2026-08-23');
    expect(entries[0].sections.map((s) => s.title)).toEqual(['Добавлено', 'Исправлено']);
    expect(entries[0].sections[0].items).toEqual([
      'Правила версионирования билдов',
      'Живая подсказка активной вкладки'
    ]);
  });

  it('сохраняет порядок записей (первая — самая свежая)', () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries[1].version).toBe('0.1.0');
  });

  it('игнорирует текст вне записей версий', () => {
    const entries = parseChangelog('# Заголовок\n\nТекст без версии\n\n## [1.0.0]\n### Добавлено\n- что-то');
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe('1.0.0');
  });

  it('поддерживает Windows-переводы строк', () => {
    const entries = parseChangelog('## [1.2.3]\r\n### Исправлено\r\n- баг\r\n');
    expect(entries[0].version).toBe('1.2.3');
    expect(entries[0].sections[0].items).toEqual(['баг']);
  });

  it('пустой файл даёт пустой список', () => {
    expect(parseChangelog('')).toEqual([]);
  });
});

describe('findChangelogEntry', () => {
  it('находит запись по версии', () => {
    const entries = parseChangelog(SAMPLE);
    const e = findChangelogEntry(entries, '0.1.0');
    expect(e?.version).toBe('0.1.0');
  });

  it('при отсутствии версии возвращает самую свежую (первую)', () => {
    const entries = parseChangelog(SAMPLE);
    const e = findChangelogEntry(entries, '9.9.9');
    expect(e?.version).toBe('0.1.1');
  });

  it('пустой список возвращает null', () => {
    expect(findChangelogEntry([], '1.0.0')).toBeNull();
  });
});
