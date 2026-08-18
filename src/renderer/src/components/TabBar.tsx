import { useState } from 'react';
import type { SessionState } from '@shared/ipc-contract';
import { parseQuickConnect } from '@shared/quick-connect';
import { useApp, type SessionTab } from '../store';
import ProtocolIcon from './ProtocolIcon';

function stateDot(state: SessionState): { cls: string; title: string } {
  switch (state.phase) {
    case 'connected':
      return { cls: 'tab-dot tab-dot--ok', title: 'Подключено' };
    case 'connecting':
      return { cls: 'tab-dot tab-dot--busy', title: 'Подключение…' };
    case 'auth-required':
      return { cls: 'tab-dot tab-dot--warn', title: 'Нужен пароль' };
    case 'error':
      return { cls: 'tab-dot tab-dot--err', title: 'Ошибка' };
    default:
      return { cls: 'tab-dot', title: 'Отключено' };
  }
}

export default function TabBar(): React.JSX.Element {
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const switchTab = useApp((s) => s.switchTab);
  const closeTab = useApp((s) => s.closeTab);
  const openDialog = useApp((s) => s.openDialog);
  const openAdHoc = useApp((s) => s.openAdHoc);
  const pushToast = useApp((s) => s.pushToast);
  const [quick, setQuick] = useState('');

  const quickConnect = (): void => {
    const parsed = parseQuickConnect(quick);
    if (!parsed.ok) {
      pushToast(parsed.error);
      return;
    }
    setQuick('');
    void openAdHoc(parsed.host);
  };

  return (
    <div className="tabbar">
      <button className="tabbar-new" title="Новая сессия (Ctrl+Shift+T)" onClick={() => openDialog({ type: 'new-session' })}>
        ＋
      </button>
      {tabs.map((tab) => {
        const dot = stateDot(tab.state);
        return (
          <div
            key={tab.sessionId}
            className={`tab${tab.sessionId === activeTabId ? ' tab--active' : ''}`}
            onClick={() => switchTab(tab.sessionId)}
            onAuxClick={(e) => {
              if (e.button === 1) void closeTab(tab.sessionId);
            }}
            title={`${tab.title} — ${dot.title}`}
          >
            <span className={`tab-dot ${dot.cls}`} />
            {tab.kind === 'terminal' && <ProtocolIcon protocol={tab.protocol as 'ssh' | 'telnet' | 'rdp' | 'vnc'} size={12} />}
            {tab.kind !== 'terminal' && <span className="tab-kind">{tab.kind.toUpperCase()}</span>}
            <span className="tab-title">{tab.title}</span>
            {tab.adHocHost && (
              <button
                className="tab-save"
                title="Сохранить как профиль"
                onClick={(e) => {
                  e.stopPropagation();
                  void useApp.getState().saveAdHocAsProfile(tab.sessionId);
                }}
              >
                💾
              </button>
            )}
            <button
              className="tab-close"
              title="Закрыть (Ctrl+W)"
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(tab.sessionId);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
      {tabs.length === 0 && <span className="tabbar-hint">Нет открытых сессий</span>}
      <div className="quick-connect">
        <input
          className="input quick-connect-input"
          placeholder="user@host[:port] — быстрое подключение"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') quickConnect();
          }}
        />
      </div>
    </div>
  );
}

export type { SessionTab };
