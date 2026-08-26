import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, LogLevel } from '@shared/ipc-contract';
import { useApp } from '../../store';
import Icon from '../Icon';
import Modal from './Modal';

const LEVELS: Array<{ value: 'all' | LogLevel; label: string }> = [
  { value: 'all', label: 'Все уровни' },
  { value: 'error', label: 'Только ошибки' },
  { value: 'warn', label: 'Ошибки и предупреждения' },
  { value: 'info', label: 'Всё' }
];

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, l = 2): string => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Цветная метка уровня записи журнала. */
function LevelBadge({ level }: { level: LogLevel }): React.JSX.Element {
  const label: Record<LogLevel, string> = { info: 'INFO', warn: 'WARN', error: 'ERR' };
  return <span className={`log-badge log-badge--${level}`}>{label[level]}</span>;
}

export default function LogDialog(): React.JSX.Element {
  const closeDialog = useApp((s) => s.closeDialog);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all');
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

  // Автопрокрутка к последней записи, пока пользователь не прокрутил вверх.
  useEffect(() => {
    const el = listRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [entries, autoScroll]);

  const onScroll = (): void => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(nearBottom);
  };

  const filtered = useMemo(() => {
    if (levelFilter === 'all') return entries;
    const order: Record<LogLevel, number> = { error: 0, warn: 1, info: 2 };
    return entries.filter((e) => order[e.level] <= order[levelFilter]);
  }, [entries, levelFilter]);

  const copyAll = async (): Promise<void> => {
    const text = filtered
      .map((e) => `[${fmtTime(e.ts)}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      useApp.getState().pushToast('Журнал скопирован в буфер обмена');
    } catch {
      useApp.getState().pushToast('Не удалось скопировать журнал');
    }
  };

  const clearAll = async (): Promise<void> => {
    await window.api.clearLogs();
    setEntries([]);
  };

  return (
    <Modal title="Журнал событий" onClose={closeDialog} width={760}>
      <div className="log-panel">
        <div className="log-bar">
          <select
            className="input"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as 'all' | LogLevel)}
            title="Фильтр по уровню важности"
          >
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <span className="log-count" title="Записей в текущем фильтре">
            {filtered.length}
          </span>
          <span className="log-spacer" />
          <button className="btn btn--sm" onClick={() => void copyAll()} title="Скопировать видимые записи в буфер обмена">
            <Icon name="copy" size={12} /> Копировать
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
        <div className="log-list" ref={listRef} onScroll={onScroll}>
          {filtered.length === 0 ? (
            <div className="log-empty">
              <Icon name="log" size={30} />
              <p>Пока нет записей.</p>
              <p className="log-empty-hint">
                Здесь появляются действия приложения и подключений — запуск сессий, переходы состояний, ошибки.
              </p>
            </div>
          ) : (
            filtered.map((e) => (
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
