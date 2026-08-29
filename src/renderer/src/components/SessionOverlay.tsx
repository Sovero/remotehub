import { useApp, type SessionTab } from '../store';
import Icon from './Icon';

export default function SessionOverlay({ tab }: { tab: SessionTab }): React.JSX.Element | null {
  const reconnectTab = useApp((s) => s.reconnectTab);
  const closeTab = useApp((s) => s.closeTab);
  const useLegacyRdpEngine = useApp((s) => s.useLegacyRdpEngine);
  const globalRdpEngine = useApp((s) => s.settings.rdpEngine);
  const state = tab.state;

  if (state.phase === 'error' || state.phase === 'closed') {
    const rdpEngine = tab.rdpEngine ?? globalRdpEngine;
    const canFallBackToLegacy = tab.kind === 'rdp' && state.phase === 'error' && rdpEngine === 'iron';
    return (
      <div className="session-overlay">
        <div className="session-overlay-icon">{state.phase === 'error' ? '⚠' : '⏻'}</div>
        <div className="session-overlay-title">
          {state.phase === 'error' ? 'Ошибка подключения' : 'Соединение закрыто'}
        </div>
        <div className="session-overlay-message">
          {'message' in state ? state.message : state.reason ?? ''}
        </div>
        <div className="session-overlay-actions">
          <button className="btn btn--primary" onClick={() => void reconnectTab(tab.sessionId)}>
            <Icon name="refresh" size={13} /> Переподключить
          </button>
          <button className="btn" onClick={() => void closeTab(tab.sessionId, true)}>
            <Icon name="close" size={13} /> Закрыть вкладку
          </button>
        </div>
        {canFallBackToLegacy && (
          <button
            className="btn session-overlay-fallback"
            title="Подключиться через системный RDP-движок Windows (mstscax) — тот же движок, что у mstsc.exe и Devolutions RDM. Помогает, когда сертификат сервера несовместим с TLS-клиентом IronRDP"
            onClick={() => void useLegacyRdpEngine(tab.sessionId)}
          >
            <Icon name="window" size={13} /> Подключиться через системный RDP
          </button>
        )}
      </div>
    );
  }

  return null;
}
