import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, LogLevel, LogSource } from '@shared/ipc-contract';
import { useApp } from '../../store';
import Icon from '../Icon';
import Modal from './Modal';

const ALL_LEVELS: LogLevel[] = ['error', 'warn', 'info'];
const LEVEL_LABELS: Record<LogLevel, string> = { error: 'Ошибки', warn: 'Предупреждения', info: 'События' };

/** Сколько записей показывать в списке (последние N отфильтрованных). */
const RENDER_LIMIT = 300;
/** Сколько последних записей полного журнала включать в диагностику. */
const DIAGNOSTICS_ENTRIES = 500;

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, l = 2): string => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Построчный формат записи — используется в копировании, экспорте и диагностике. */
function formatEntry(e: LogEntry): string {
  return `[${fmtTime(e.ts)}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}`;
}

/** Цветная метка уровня записи журнала. */
function LevelBadge({ level }: { level: LogLevel }): React.JSX.Element {
  const label: Record<LogLevel, string> = { info: 'INFO', warn: 'WARN', error: 'ERR' };
  return <span className={`log-badge log-badge--${level}`}>{label[level]}</span>;
}

export default function LogDialog(): React.JSX.Element {
  const closeDialog = useApp((s) => s.closeDialog);
  const patchSettings = useApp((s) => s.patchSettings);
  const savedSize = useApp((s) => s.settings.logDialogSize);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<Record<LogLevel, boolean>>({ error: true, warn: true, info: true });
  const [excludedSources, setExcludedSources] = useState<Set<LogSource>>(new Set());
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Первичная загрузка + подписка на живые записи из main.
  useEffect(() => {
    let alive = true;
    void window.api.getLogs().then((res) => {
      if (alive) setEntries(res.entries);
    });
    const off = window.api.onLogEntry((entry) => {
      if (alive) setEntries((prev) => [...prev, entry]);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Источники, реально встречающиеся в журнале — список строится из данных, не хардкодится.
  const sources = useMemo(() => Array.from(new Set(entries.map((e) => e.source))).sort(), [entries]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!levelFilter[e.level]) return false;
      if (excludedSources.has(e.source)) return false;
      if (query && !e.message.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [entries, levelFilter, excludedSources, search]);

  const visible = useMemo(() => filtered.slice(-RENDER_LIMIT), [filtered]);

  // Автопрокрутка к последней записи, пока пользователь не прокрутил вверх.
  useEffect(() => {
    const el = listRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [visible, autoScroll]);

  const onScroll = (): void => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(nearBottom);
  };

  const toggleLevel = (level: LogLevel): void => {
    setLevelFilter((prev) => ({ ...prev, [level]: !prev[level] }));
  };

  const toggleSource = (source: LogSource): void => {
    setExcludedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const resetFilters = (): void => {
    setLevelFilter({ error: true, warn: true, info: true });
    setExcludedSources(new Set());
    setSearch('');
  };

  const copyAll = async (): Promise<void> => {
    const text = filtered.map(formatEntry).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      useApp.getState().pushToast('Журнал скопирован в буфер обмена');
    } catch {
      useApp.getState().pushToast('Не удалось скопировать журнал');
    }
  };

  const exportLog = async (): Promise<void> => {
    const text = filtered.map(formatEntry).join('\n');
    const res = await window.api.logsExport(text);
    if (res.ok) {
      useApp.getState().pushToast(`Журнал экспортирован: ${res.path}`);
    } else if (!res.canceled) {
      useApp.getState().pushToast(res.error ?? 'Не удалось экспортировать журнал');
    }
  };

  const copyDiagnostics = async (): Promise<void> => {
    try {
      const info = await window.api.appInfo();
      const settings = useApp.getState().settings;
      const lastEntries = entries.slice(-DIAGNOSTICS_ENTRIES);
      const lines = [
        'Remote Hub — диагностика',
        `Версия: ${info.version} (Electron ${info.electron}, ${info.arch})`,
        '',
        'Настройки:',
        `  theme: ${settings.theme}`,
        `  rdpEngine: ${settings.rdpEngine}`,
        `  fontSize: ${settings.fontSize}`,
        `  fontFamily: ${settings.fontFamily}`,
        `  accent: ${settings.accent}`,
        `  confirmOnDelete: ${settings.confirmOnDelete}`,
        `  restoreTabs: ${settings.restoreTabs}`,
        `  rdpAutoAcceptCert: ${settings.rdpAutoAcceptCert}`,
        `  monitorIntervalSec: ${settings.monitorIntervalSec}`,
        '',
        `Записи журнала (последние ${lastEntries.length}):`,
        ...lastEntries.map(formatEntry)
      ];
      await navigator.clipboard.writeText(lines.join('\n'));
      useApp.getState().pushToast('Диагностика скопирована в буфер обмена');
    } catch {
      useApp.getState().pushToast('Не удалось скопировать диагностику');
    }
  };

  const clearAll = async (): Promise<void> => {
    await window.api.clearLogs();
    setEntries([]);
  };

  const trimmedSearch = search.trim();

  return (
    <Modal
      title="Журнал событий"
      onClose={closeDialog}
      width={savedSize?.width ?? 860}
      height={savedSize?.height ?? 560}
      resizable
      onResize={(size) => void patchSettings({ logDialogSize: size })}
    >
      <div className="log-panel">
        <div className="log-bar">
          <div className="log-filter-group" title="Фильтр по уровню важности">
            {ALL_LEVELS.map((level) => (
              <label
                key={level}
                className={`log-filter-chip log-filter-chip--${level}${levelFilter[level] ? ' log-filter-chip--active' : ''}`}
              >
                <input type="checkbox" checked={levelFilter[level]} onChange={() => toggleLevel(level)} />
                {LEVEL_LABELS[level]}
              </label>
            ))}
          </div>
          {sources.length > 0 && (
            <div className="log-filter-group" title="Фильтр по источнику">
              {sources.map((s) => (
                <label
                  key={s}
                  className={`log-filter-chip${!excludedSources.has(s) ? ' log-filter-chip--active' : ''}`}
                >
                  <input type="checkbox" checked={!excludedSources.has(s)} onChange={() => toggleSource(s)} />
                  {s}
                </label>
              ))}
            </div>
          )}
          <input
            className="input input--search"
            placeholder="Поиск по сообщению…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="log-count" title="Записей в текущем фильтре">
            {filtered.length}
          </span>
          <span className="log-spacer" />
          <button className="btn btn--sm" onClick={() => void copyAll()} title="Скопировать видимые записи в буфер обмена">
            <Icon name="copy" size={12} /> Копировать
          </button>
          <button
            className="btn btn--sm"
            onClick={() => void exportLog()}
            title="Сохранить отфильтрованный журнал в файл"
            disabled={filtered.length === 0}
          >
            <Icon name="export" size={12} /> Экспорт
          </button>
          <button
            className="btn btn--sm"
            onClick={() => void copyDiagnostics()}
            title="Скопировать версию, настройки и последние записи журнала в буфер обмена"
          >
            <Icon name="log" size={12} /> Скопировать диагностику
          </button>
          <button
            className="btn btn--sm btn--danger"
            onClick={() => void clearAll()}
            title="Очистить журнал"
            disabled={entries.length === 0}
          >
            <Icon name="trash" size={12} /> Очистить
          </button>
        </div>
        {filtered.length > RENDER_LIMIT && (
          <div className="log-limit-banner">
            Показаны последние {RENDER_LIMIT} из {filtered.length}
          </div>
        )}
        <div className="log-list" ref={listRef} onScroll={onScroll}>
          {entries.length === 0 ? (
            <div className="log-empty">
              <Icon name="log" size={30} />
              <p>Пока нет записей.</p>
              <p className="log-empty-hint">
                Здесь появляются действия приложения и подключений — запуск сессий, переходы состояний, ошибки.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="log-empty">
              <Icon name={trimmedSearch ? 'search' : 'log'} size={30} />
              {trimmedSearch ? (
                <p>Ничего не найдено по «{trimmedSearch}».</p>
              ) : (
                <p>Нет записей с текущими фильтрами.</p>
              )}
              <button className="btn btn--sm" onClick={resetFilters}>
                Сбросить фильтры
              </button>
            </div>
          ) : (
            visible.map((e) => (
              <div key={e.id} className={`log-entry log-entry--${e.level}`}>
                <span className="log-time">{fmtTime(e.ts)}</span>
                <LevelBadge level={e.level} />
                <span className="log-source">{e.source}</span>
                <span className="log-msg">{e.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
