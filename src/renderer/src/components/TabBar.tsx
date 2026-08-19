import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionState } from '@shared/ipc-contract';
import { parseQuickConnect } from '@shared/quick-connect';
import { findNode } from '@shared/tree';
import { pasteToTerminal } from '../lib/termRegistry';
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
  const [snipsOpen, setSnipsOpen] = useState(false);
  const snipsRef = useRef<HTMLDivElement>(null);
  const snippets = useApp((s) => s.settings.snippets);
  const tree = useApp((s) => s.tree);

  const activeTab = tabs.find((t) => t.sessionId === activeTabId) ?? null;
  const activeSshHost = useMemo(() => {
    if (!activeTab || activeTab.kind !== 'terminal' || activeTab.protocol !== 'ssh') return null;
    if (activeTab.adHocHost) return activeTab.adHocHost;
    if (activeTab.hostId) {
      const node = findNode(tree, activeTab.hostId);
      if (node && node.kind === 'host') return node;
    }
    return null;
  }, [activeTab, tree]);

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (snipsRef.current && !snipsRef.current.contains(e.target as Node)) setSnipsOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const quickConnect = (): void => {
    const parsed = parseQuickConnect(quick);
    if (!parsed.ok) {
      pushToast(parsed.error);
      return;
    }
    setQuick('');
    void openAdHoc(parsed.host);
  };

  const insertSnippet = (command: string): void => {
    if (activeTabId) {
      const ok = pasteToTerminal(activeTabId, command);
      if (!ok) pushToast('В активной вкладке нет терминала');
    } else {
      pushToast('Нет активного терминала');
    }
    setSnipsOpen(false);
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
      <div className="tabbar-tools">
        {activeSshHost && (
          <button
            className="tabbar-new"
            title="Туннели (порт-форвардинг)"
            onClick={() =>
              openDialog({
                type: 'tunnels',
                sessionId: activeTab?.sessionId ?? '',
                title: activeTab?.title ?? '',
                host: activeSshHost
              })
            }
          >
            ⧉
          </button>
        )}
        <div className="snips" ref={snipsRef}>
          <button
            className="tabbar-new"
            title="Сниппеты"
            onClick={() => setSnipsOpen((v) => !v)}
          >
            Σ
          </button>
          {snipsOpen && (
            <div className="snips-pop">
              {snippets.length === 0 ? (
                <div className="snips-empty">Сниппетов пока нет</div>
              ) : (
                snippets.map((s) => (
                  <button key={s.id} className="snips-item" onClick={() => insertSnippet(s.command)}>
                    <span className="snips-name">{s.name}</span>
                    <span className="snips-cmd">{s.command}</span>
                  </button>
                ))
              )}
              <button
                className="snips-manage"
                onClick={() => {
                  setSnipsOpen(false);
                  openDialog({ type: 'snippets' });
                }}
              >
                Управление сниппетами…
              </button>
            </div>
          )}
        </div>
      </div>
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
