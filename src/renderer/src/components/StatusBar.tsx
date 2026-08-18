import { useEffect, useState } from 'react';
import { useApp } from '../store';

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function StatusBar(): React.JSX.Element {
  const appInfo = useApp((s) => s.appInfo);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const active = tabs.find((t) => t.sessionId === activeTabId);

  const stateLabel: Record<string, string> = {
    connecting: 'Подключение…',
    'auth-required': 'Нужен пароль',
    connected: 'Подключено',
    error: 'Ошибка',
    closed: 'Отключено'
  };

  return (
    <footer className="statusbar">
      {active ? (
        <>
          <span className="statusbar-item">
            {active.protocol.toUpperCase()} · {active.title}
          </span>
          <span className="statusbar-item statusbar-muted">{stateLabel[active.state.phase] ?? active.state.phase}</span>
          {active.startedAt && active.state.phase === 'connected' && (
            <span className="statusbar-item statusbar-muted">{formatElapsed(Date.now() - active.startedAt)}</span>
          )}
        </>
      ) : (
        <span className="statusbar-item">Готово</span>
      )}
      <span className="statusbar-spacer" />
      {appInfo && (
        <span className="statusbar-item statusbar-muted">
          Remote Hub v{appInfo.version} · Electron {appInfo.electron} · {appInfo.platform}
        </span>
      )}
    </footer>
  );
}
