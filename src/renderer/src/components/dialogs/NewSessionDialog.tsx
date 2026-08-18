import { useMemo, useState } from 'react';
import type { Host } from '@shared/types';
import { flattenHosts, matchesHostQuery } from '@shared/tree';
import { useApp } from '../../store';
import ProtocolIcon from '../ProtocolIcon';
import Modal from './Modal';

export default function NewSessionDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const tree = useApp((s) => s.tree);
  const openSession = useApp((s) => s.openSession);
  const closeDialog = useApp((s) => s.closeDialog);
  const [query, setQuery] = useState('');

  const hosts = useMemo(() => {
    const all = flattenHosts(tree);
    const q = query.trim();
    if (!q) return all;
    return all.filter((h) => matchesHostQuery(h, q, null));
  }, [tree, query]);

  const connect = (host: Host): void => {
    closeDialog();
    void openSession(host);
  };

  return (
    <Modal title="Новая сессия" onClose={onClose} width={460}>
      <div className="form">
        <div className="form-row">
          <input
            className="input"
            placeholder="Поиск хоста…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <div className="host-list">
          {hosts.length === 0 ? (
            <div className="host-list-empty">Ничего не найдено</div>
          ) : (
            hosts.map((h) => (
              <button key={h.id} className="host-list-item" onClick={() => connect(h)}>
                <ProtocolIcon protocol={h.protocol} />
                <span className="host-list-name">{h.name}</span>
                <span className="host-list-sub">
                  {h.protocol.toUpperCase()} · {h.host}:{h.port ?? ''}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
