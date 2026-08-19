import { useCallback, useEffect, useState } from 'react';
import type { TunnelInfo } from '@shared/ipc-contract';
import type { Host } from '@shared/types';
import Modal from './Modal';

export default function TunnelsDialog({
  sessionId,
  title,
  host,
  onClose
}: {
  sessionId: string;
  title: string;
  host: Host;
  onClose: () => void;
}): React.JSX.Element {
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [localPort, setLocalPort] = useState('');
  const [targetHost, setTargetHost] = useState('');
  const [targetPort, setTargetPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await window.api.tunnelsList(sessionId);
    setTunnels(res.tunnels);
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (): Promise<void> => {
    setError(null);
    const lp = Number(localPort);
    const tp = Number(targetPort);
    if (!Number.isInteger(lp) || lp < 1 || lp > 65535) {
      setError('Локальный порт — целое число от 1 до 65535');
      return;
    }
    if (!Number.isInteger(tp) || tp < 1 || tp > 65535) {
      setError('Целевой порт — целое число от 1 до 65535');
      return;
    }
    setBusy(true);
    try {
      const res = await window.api.tunnelsAdd({
        sessionId,
        host,
        localPort: lp,
        targetHost: targetHost.trim() || 'localhost',
        targetPort: tp
      });
      if (!res.ok) {
        setError(res.error ?? 'Не удалось создать туннель');
        return;
      }
      setLocalPort('');
      setTargetHost('');
      setTargetPort('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const stop = async (tunnelId: string): Promise<void> => {
    await window.api.tunnelsStop(sessionId, tunnelId);
    await load();
  };

  return (
    <Modal title={`Туннели — ${title}`} onClose={onClose} width={580}>
      <p className="tunnels-hint">
        Локальный порт перенаправляется на целевой хост:порт через SSH-соединение сеанса. Туннели закрываются вместе
        с сеансом.
      </p>

      <div className="tunnels-add">
        <input
          className="input tunnels-port"
          placeholder="Лок. порт"
          value={localPort}
          onChange={(e) => setLocalPort(e.target.value.replace(/[^0-9]/g, ''))}
        />
        <span className="tunnels-arrow">→</span>
        <input
          className="input tunnels-host"
          placeholder="целевой хост (по умолч. localhost)"
          value={targetHost}
          onChange={(e) => setTargetHost(e.target.value)}
        />
        <input
          className="input tunnels-port"
          placeholder="Цел. порт"
          value={targetPort}
          onChange={(e) => setTargetPort(e.target.value.replace(/[^0-9]/g, ''))}
        />
        <button className="btn btn--primary" disabled={busy} onClick={() => void add()}>
          Добавить
        </button>
      </div>

      {error && <div className="tunnels-error">{error}</div>}

      <div className="tunnels-list">
        {tunnels.length === 0 ? (
          <div className="tunnels-empty">Активных туннелей нет</div>
        ) : (
          tunnels.map((t) => (
            <div key={t.id} className="tunnels-item">
              <span className={`tunnels-dot${t.active ? ' tunnels-dot--on' : ' tunnels-dot--off'}`} />
              <span className="tunnels-route">
                127.0.0.1:{t.localPort} → {t.targetHost}:{t.targetPort}
              </span>
              <span className={`tunnels-status${t.active ? '' : ' tunnels-status--err'}`}>
                {t.active ? 'активен' : t.error ?? 'остановлен'}
              </span>
              <button className="btn btn--sm btn--danger" onClick={() => void stop(t.id)}>
                Остановить
              </button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
