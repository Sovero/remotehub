import { useMemo, useState } from 'react';
import type { HistoryEntry } from '@shared/types';
import { useApp } from '../store';
import Icon from './Icon';
import ProtocolIcon from './ProtocolIcon';

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'только что';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const days = Math.floor(hr / 24);
  return `${days} дн назад`;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}с`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}м ${rem}с`;
}

export default function HistoryPanel(): React.JSX.Element {
  const history = useApp((s) => s.history);
  const clearHistory = useApp((s) => s.clearHistory);
  const openDialog = useApp((s) => s.openDialog);
  const openSession = useApp((s) => s.openSession);
  const closeDialog = useApp((s) => s.closeDialog);
  const tree = useApp((s) => s.tree);
  const pushToast = useApp((s) => s.pushToast);
  const [filter, setFilter] = useState('');
  const [protocolFilter, setProtocolFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    let entries = [...history];
    if (protocolFilter !== 'all') {
      entries = entries.filter((e) => e.protocol === protocolFilter);
    }
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      entries = entries.filter(
        (e) =>
          e.hostName.toLowerCase().includes(q) ||
          e.address.toLowerCase().includes(q)
      );
    }
    return entries;
  }, [history, filter, protocolFilter]);

  const handleConnect = (entry: HistoryEntry): void => {
    // Find the host in the tree
    const findHost = (nodes: any[]): any => {
      for (const n of nodes) {
        if (n.kind === 'group' && n.children) {
          const found = findHost(n.children);
          if (found) return found;
        } else if (n.kind === 'host' && n.id === entry.hostId) {
          return n;
        }
      }
      return null;
    };
    const host = findHost(tree);
    if (host) {
      void openSession(host);
    } else {
      pushToast('Профиль хоста не найден');
    }
  };

  return (
    <div className="history-panel">
      <div className="history-header">
        <h3>История подключений</h3>
        <div className="history-actions">
          <input
            className="input input--search"
            placeholder="Поиск…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            className="input"
            value={protocolFilter}
            onChange={(e) => setProtocolFilter(e.target.value)}
          >
            <option value="all">Все протоколы</option>
            <option value="ssh">SSH</option>
            <option value="rdp">RDP</option>
            <option value="vnc">VNC</option>
            <option value="telnet">Telnet</option>
          </select>
          {history.length > 0 && (
            <button className="btn btn--sm btn--danger" onClick={() => void clearHistory()}>
              <Icon name="trash" size={12} /> Очистить
            </button>
          )}
          <button className="btn btn--sm" onClick={() => closeDialog()}>
            <Icon name="close" size={12} />
          </button>
        </div>
      </div>
      <div className="history-list">
        {filtered.length === 0 ? (
          <div className="history-empty">
            <Icon name="history" size={32} />
            <p>Нет записей</p>
          </div>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id} className={`history-item ${entry.ok ? '' : 'history-item--error'}`}>
              <div className="history-item-icon">
                <ProtocolIcon protocol={entry.protocol} size={14} />
              </div>
              <div className="history-item-info">
                <div className="history-item-name">{entry.hostName}</div>
                <div className="history-item-address">{entry.address}</div>
              </div>
              <div className="history-item-meta">
                <span className="history-item-time">{formatRelative(entry.connectedAt)}</span>
                {entry.durationMs != null && (
                  <span className="history-item-duration">{formatDuration(entry.durationMs)}</span>
                )}
              </div>
              <button
                className="btn btn--sm btn--icon"
                title="Подключиться снова"
                onClick={() => handleConnect(entry)}
              >
                <Icon name="play" size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
