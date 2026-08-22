import { useEffect, useMemo, useState } from 'react';
import { findNode, flattenHosts } from '@shared/tree';
import { useApp } from '../store';
import Icon from './Icon';
import ProtocolIcon from './ProtocolIcon';

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Иконка состояния сессии для строки статуса (по единому набору). */
function StateIcon({ phase }: { phase: string }): React.JSX.Element {
  switch (phase) {
    case 'connecting':
      return <Icon name="spinner" size={11} className="icon-spin" />;
    case 'connected':
      return <Icon name="check" size={11} />;
    case 'auth-required':
      return <Icon name="key" size={11} />;
    case 'error':
      return <Icon name="warning" size={11} />;
    case 'closed':
      return <Icon name="power" size={11} />;
    default:
      return <Icon name="power" size={11} />;
  }
}

export default function StatusBar(): React.JSX.Element {
  const appInfo = useApp((s) => s.appInfo);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const tree = useApp((s) => s.tree);
  const [, tick] = useState(0);

  // Индикатор: всего хостов в дереве / активных (живых) сессий.
  const hostCount = useMemo(() => flattenHosts(tree).length, [tree]);
  const activeSessions = useMemo(
    () =>
      tabs.filter((t) => t.state.phase === 'connecting' || t.state.phase === 'connected' || t.state.phase === 'auth-required')
        .length,
    [tabs]
  );

  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const active = tabs.find((t) => t.sessionId === activeTabId);

  // Живая подсказка активной вкладки: адрес RDP-сервера или локальный порт VNC-моста.
  const liveHint = useMemo(() => {
    if (!active) return null;
    if (active.protocol === 'vnc' && active.vnc?.port) {
      return { icon: 'link' as const, text: `порт ${active.vnc.port}`, title: 'Локальный порт VNC-моста' };
    }
    if (active.protocol === 'rdp') {
      const node = active.hostId ? findNode(tree, active.hostId) : null;
      const h = node && node.kind === 'host' ? node : active.adHocHost;
      if (h) {
        const addr = h.port && h.port !== 3389 ? `${h.host}:${h.port}` : h.host;
        return { icon: 'host' as const, text: addr, title: 'Адрес RDP-сервера' };
      }
    }
    return null;
  }, [active, tree]);

  const stateLabel: Record<string, string> = {
    connecting: 'Подключение…',
    'auth-required': 'Нужен пароль',
    connected: 'Подключено',
    error: 'Ошибка',
    closed: 'Отключено'
  };

  return (
    <footer className="statusbar">
      <span
        className="statusbar-item statusbar-counters"
        title={`Хостов: ${hostCount} · Активных сессий: ${activeSessions}`}
      >
        <Icon name="tree" size={11} />
        <span className="statusbar-count">{hostCount}</span>
        <span className="statusbar-divider" aria-hidden="true" />
        <Icon name="tab" size={11} />
        <span className="statusbar-count">{activeSessions}</span>
      </span>
      {active ? (
        <>
          <span className="statusbar-item">
            <ProtocolIcon protocol={active.protocol as 'ssh' | 'telnet' | 'rdp' | 'vnc'} size={12} />
            {active.protocol.toUpperCase()} · {active.title}
          </span>
          <span className={`statusbar-item statusbar-state statusbar-state--${active.state.phase}`}>
            <StateIcon phase={active.state.phase} />
            {stateLabel[active.state.phase] ?? active.state.phase}
          </span>
          {active.startedAt && active.state.phase === 'connected' && (
            <span className="statusbar-item statusbar-muted">{formatElapsed(Date.now() - active.startedAt)}</span>
          )}
          {liveHint && (
            <span className="statusbar-item statusbar-muted statusbar-live-hint" title={liveHint.title}>
              <Icon name={liveHint.icon} size={11} />
              {liveHint.text}
            </span>
          )}
        </>
      ) : (
        <span className="statusbar-item">
          <Icon name="check" size={11} /> Готово
        </span>
      )}
      <span className="statusbar-spacer" />
      {appInfo && (
        <span className="statusbar-item statusbar-muted">
          Remote Hub v{appInfo.version} · Electron {appInfo.electron} · {appInfo.arch}
        </span>
      )}
    </footer>
  );
}
