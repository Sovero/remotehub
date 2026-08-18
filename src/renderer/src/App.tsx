import { useEffect } from 'react';
import type { SessionState } from '@shared/ipc-contract';
import { useApp } from './store';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import StatusBar from './components/StatusBar';
import Welcome from './components/Welcome';
import Toasts from './components/Toasts';
import DialogRoot from './components/DialogRoot';
import TerminalPane from './components/TerminalPane';
import SessionOverlay from './components/SessionOverlay';

export default function App(): React.JSX.Element {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);
  const tree = useApp((s) => s.tree);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);

  useEffect(() => {
    void init();
  }, [init]);

  // События сессий из main
  useEffect(() => {
    const offData = window.api.onSessionData(() => {
      // данные идут напрямую в TerminalPane по sessionId
    });
    const offState = window.api.onSessionState((payload) => {
      useApp.getState().applySessionState(payload.sessionId, payload.state);
    });
    const offRdp = window.api.onRdpExited((payload) => {
      const state: SessionState = payload.error
        ? { phase: 'error', message: payload.error }
        : { phase: 'closed', reason: `Сессия RDP завершена (код ${payload.code ?? '?'})` };
      useApp.getState().applySessionState(payload.sessionId, state);
    });
    const offNotify = window.api.onNotify((message) => {
      useApp.getState().pushToast(message);
    });
    const offMenu = window.api.onMenuCommand((command) => {
      const s = useApp.getState();
      if (command === 'hotkeys') s.openDialog({ type: 'hotkeys' });
      else if (command === 'settings') s.openDialog({ type: 'settings' });
      else if (command === 'new-session') s.openDialog({ type: 'new-session' });
    });
    return () => {
      offData();
      offState();
      offRdp();
      offNotify();
      offMenu();
    };
  }, []);

  // Горячие клавиши
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useApp.getState();
      const target = e.target as HTMLElement;
      const inAppInput = !!target.closest?.('.modal, .sidebar-search, .quick-connect, .host-list, .tabbar');
      if (!e.ctrlKey && !e.metaKey) return;

      if (e.key === 'Tab' && e.ctrlKey) {
        e.preventDefault();
        const tabsList = s.tabs;
        if (tabsList.length > 1) {
          const idx = tabsList.findIndex((t) => t.sessionId === s.activeTabId);
          const next = tabsList[(idx + 1) % tabsList.length];
          s.switchTab(next.sessionId);
        }
        return;
      }
      if (inAppInput) return;

      if (e.key === 'W') {
        e.preventDefault();
        if (s.activeTabId) void s.closeTab(s.activeTabId);
      } else if (e.key === 'T' && e.shiftKey) {
        e.preventDefault();
        s.openDialog({ type: 'new-session' });
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        void s.patchSettings({ fontSize: Math.min(24, s.settings.fontSize + 1) });
      } else if (e.key === '-') {
        e.preventDefault();
        void s.patchSettings({ fontSize: Math.max(8, s.settings.fontSize - 1) });
      } else if (e.key >= '1' && e.key <= '9' && !e.shiftKey) {
        const idx = Number(e.key) - 1;
        const tab = s.tabs[idx];
        if (tab) s.switchTab(tab.sessionId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) {
    return (
      <div className="app app--loading">
        <div className="loading">Загрузка…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <Sidebar />
      </aside>
      <main className="workspace">
        <TabBar />
        <section className="content">
          {tabs.length === 0 ? (
            tree.length === 0 ? (
              <Welcome />
            ) : (
              <EmptyWorkspace />
            )
          ) : (
            <div className="session-area">
              {tabs.map((tab) => (
                <div
                  key={tab.sessionId}
                  className={`session-pane${tab.sessionId === activeTabId ? '' : ' session-pane--hidden'}`}
                >
                  {tab.kind === 'terminal' ? (
                    <TerminalPane tab={tab} active={tab.sessionId === activeTabId} />
                  ) : tab.kind === 'rdp' ? (
                    <RdpPane tab={tab} />
                  ) : (
                    <PlaceholderPane tab={tab} />
                  )}
                  <SessionOverlay tab={tab} />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <StatusBar />
      <Toasts />
      <DialogRoot />
    </div>
  );
}

function EmptyWorkspace(): React.JSX.Element {
  return (
    <div className="placeholder-panel">
      <div className="placeholder-icon">▤</div>
      <p>Выберите профиль в дереве слева, чтобы открыть сессию.</p>
      <p className="placeholder-muted">Двойной клик по хосту или контекстное меню → «Подключить».</p>
    </div>
  );
}

function RdpPane({
  tab
}: {
  tab: { sessionId: string; state: { phase: string }; title: string };
}): React.JSX.Element {
  const reconnectTab = useApp((s) => s.reconnectTab);
  const closeTab = useApp((s) => s.closeTab);
  if (tab.state.phase !== 'connected') {
    return (
      <div className="placeholder-panel">
        <div className="placeholder-icon">▤</div>
        <p>Запуск Remote Desktop…</p>
        <p className="placeholder-muted">{tab.title}</p>
      </div>
    );
  }
  return (
    <div className="rdp-pane">
      <div className="rdp-icon">🖥</div>
      <div className="rdp-title">Remote Desktop запущен</div>
      <div className="rdp-text">
        Сессия открыта в отдельном окне {`mstsc`}. Вкладка останется до закрытия окна Remote Desktop — закрытие
        приложения её не прервёт.
      </div>
      <div className="rdp-actions">
        <button className="btn btn--primary" onClick={() => void reconnectTab(tab.sessionId)}>
          Запустить заново
        </button>
        <button className="btn" onClick={() => void closeTab(tab.sessionId, true)}>
          Закрыть вкладку
        </button>
      </div>
    </div>
  );
}

function PlaceholderPane({ tab }: { tab: { kind: string; protocol: string; title: string } }): React.JSX.Element {
  const names: Record<string, string> = {
    vnc: 'VNC появится в следующей сборке (T07)',
    sftp: 'SFTP появится в следующей сборке (T08)'
  };
  return (
    <div className="placeholder-panel">
      <div className="placeholder-icon">▤</div>
      <p>{names[tab.kind] ?? 'Этот тип сессии ещё не реализован'}</p>
      <p className="placeholder-muted">{tab.title}</p>
    </div>
  );
}
