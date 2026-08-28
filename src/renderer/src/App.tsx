import { useEffect, useMemo, useRef, useState } from 'react';
import type { RdpEngine } from '@shared/types';
import { findNode } from '@shared/tree';
import { useApp } from './store';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import StatusBar from './components/StatusBar';
import Welcome from './components/Welcome';
import Toasts from './components/Toasts';
import DialogRoot from './components/DialogRoot';
import InteractiveTour from './components/InteractiveTour';
import TerminalPane from './components/TerminalPane';
import SessionOverlay from './components/SessionOverlay';
import SftpPane from './components/SftpPane';
import VncViewer from './components/VncViewer';
import RdpCanvas from './components/RdpCanvas';
import IronRdpView from './components/IronRdpView';
import LegacyRdpView from './components/LegacyRdpView';
import Icon from './components/Icon';

export default function App(): React.JSX.Element {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);
  const tree = useApp((s) => s.tree);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const theme = useApp((s) => s.settings.theme);
  const accent = useApp((s) => s.settings.accent);
  const settings = useApp((s) => s.settings);

  const dialog = useApp((s) => s.dialog);
  const onboardingOpen = useApp((s) => s.onboardingOpen);
  // Пока модальный диалог/онбординг открыт поверх встроенного нативного окна
  // legacy-движка RDP, оно выше Chromium в Z-порядке и перехватывает клики —
  // без этого не закрываются диалоги и падает navigator.clipboard.writeText()
  // (документ теряет фокус). Прячем встроенные окна на время показа диалога.
  useEffect(() => {
    window.api.rdpLegacyOverlay?.(dialog !== null || onboardingOpen);
  }, [dialog, onboardingOpen]);
  // Авто-открытие мастера при первом запуске: один раз за сессию и не поверх открытого диалога.
  const tourAutoOpened = useRef(false);
  useEffect(() => {
    if (
      ready &&
      !settings.onboardingDone &&
      !tourAutoOpened.current &&
      useApp.getState().dialog === null
    ) {
      tourAutoOpened.current = true;
      useApp.getState().openOnboarding();
    }
  }, [ready, settings.onboardingDone]);

  // Авто-открытие раздела «Неполадки» при первой ошибке подключения (один раз).
  useEffect(() => {
    if (!ready || settings.helpErrorShown) return;
    if (tabs.some((t) => t.state.phase === 'error')) {
      const s = useApp.getState();
      s.closeOnboarding();
      s.openDialog({ type: 'help', sectionId: 'troubleshooting' });
      void s.patchSettings({ helpErrorShown: true });
    }
  }, [ready, settings.helpErrorShown, tabs]);

  // Тема и акцентный цвет: data-theme на <html> + CSS-переменные.
  // --accent-fg — цвет текста/иконок поверх акцентного фона: тёмный для
  // светлых акцентов (жёлтый, циан), белый для тёмных (синий, зелёный, красный).
  // --accent-hover — hover-фон: тёмные акценты затемняем (белый текст не теряет
  // контраст), светлые осветляем (тёмный текст читается ещё лучше).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-hover', accentHover(accent));
    root.style.setProperty('--accent-fg', accentFg(accent));
  }, [theme, accent]);


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
    const offVncErr = window.api.onVncError((payload) => {
      useApp
        .getState()
        .applySessionState(payload.sessionId, { phase: 'error', message: payload.message });
    });
    const offNotify = window.api.onNotify((message) => {
      useApp.getState().pushToast(message);
    });
    const offMenu = window.api.onMenuCommand((command) => {
      const s = useApp.getState();
      if (command === 'hotkeys') s.openDialog({ type: 'hotkeys' });
      else if (command === 'help') {
        s.closeOnboarding();
        s.openDialog({ type: 'help' });
      } else if (command === 'settings') s.openDialog({ type: 'settings' });
      else if (command === 'onboarding') {
        s.closeDialog();
        s.openOnboarding();
      } else if (command === 'new-session') s.openDialog({ type: 'new-session' });
    });
    const offUpdate = window.api.onUpdateState((state) => {
      useApp.getState().applyUpdateState(state);
    });
    const offRdpLegacyExited = window.api.onRdpLegacyExited?.((payload) => {
      const s = useApp.getState();
      if (payload.error) {
        s.applySessionState(payload.sessionId, { phase: 'error', message: payload.error });
      } else {
        s.applySessionState(payload.sessionId, { phase: 'closed', reason: 'RDP-сессия завершена' });
      }
    });
    const offRdpjsState = window.api.onRdpjsState?.((payload) => {
      const s = useApp.getState();
      const phase = payload.state === 'connected' ? 'connected'
        : payload.state === 'connecting' ? 'connecting'
        : payload.error ? { phase: 'error' as const, message: payload.error }
        : { phase: 'closed' as const, reason: 'RDP-сессия завершена' };
      if (typeof phase === 'string') {
        s.applySessionState(payload.sessionId, { phase });
      } else {
        s.applySessionState(payload.sessionId, phase);
      }
    });
    return () => {
      offData();
      offState();
      offRdpjsState?.();
      offRdpLegacyExited?.();
      offVncErr();
      offNotify();
      offMenu();
      offUpdate();
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
    return <LoadingSplash />;
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
                    <RdpPane tab={tab} active={tab.sessionId === activeTabId} />
                  ) : tab.kind === 'vnc' ? (
                    <VncViewer tab={tab} />
                  ) : tab.kind === 'sftp' ? (
                    <SftpPane tab={tab} />
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
      {onboardingOpen && <InteractiveTour />}
    </div>
  );
}

/** Заставка при старте: логотип, имя и версия приложения (до готовности). */
function LoadingSplash(): React.JSX.Element {
  const [version, setVersion] = useState<string | null>(null);
  const appInfo = useApp((s) => s.appInfo);

  useEffect(() => {
    if (appInfo) {
      setVersion(appInfo.version);
      return;
    }
    let alive = true;
    void window.api
      .appInfo()
      .then((info) => {
        if (alive) setVersion(info.version);
      })
      .catch(() => {
        if (alive) setVersion(null);
      });
    return () => {
      alive = false;
    };
  }, [appInfo]);

  return (
    <div className="app app--loading">
      <div className="loading">
        <div className="loading-logo">
          <Icon name="window" size={34} />
        </div>
        <div className="loading-name">Remote Hub</div>
        {version && <div className="loading-version">Версия {version}</div>}
        <div className="loading-progress">Загрузка…</div>
      </div>
    </div>
  );
}

function EmptyWorkspace(): React.JSX.Element {
  return (
    <div className="placeholder-panel">
      <div className="placeholder-icon">
        <Icon name="host" size={44} />
      </div>
      <p>Выберите профиль в дереве слева, чтобы открыть сессию.</p>
      <p className="placeholder-muted">Двойной клик по хосту или контекстное меню → «Подключить».</p>
    </div>
  );
}

function RdpPane({
  tab,
  active
}: {
  tab: {
    sessionId: string;
    hostId: string | null;
    title: string;
    state: { phase: string };
    rdpEngine?: RdpEngine;
  };
  active: boolean;
}): React.JSX.Element {
  const reconnectTab = useApp((s) => s.reconnectTab);
  const tree = useApp((s) => s.tree);
  const selectedRdpEngine = useApp((s) => s.settings.rdpEngine);
  const rdpEngine = tab.rdpEngine ?? selectedRdpEngine;

  const host = useMemo(() => {
    if (!tab.hostId) return null;
    const node = findNode(tree, tab.hostId);
    return node && node.kind === 'host' ? node : null;
  }, [tree, tab.hostId]);

  if (rdpEngine !== 'iron' && rdpEngine !== 'legacy' && tab.state.phase !== 'connected') {
    return (
      <div className="placeholder-panel">
        <div className="placeholder-icon">
          <Icon name="spinner" size={44} className="icon-spin" />
        </div>
        <p>Запуск Remote Desktop…</p>
        <p className="placeholder-muted">{tab.title}</p>
      </div>
    );
  }

  const rdpWidth = host?.rdp.width ?? 1366;
  const rdpHeight = host?.rdp.height ?? 768;

  return (
    <div className="rdp-pane rdp-pane--embedded">
      <div className="rdp-toolbar">
        {host?.rdp.multiMonitor && (
          <span className="rdp-mode-note" title="Режим всех мониторов адаптирован к одной встроенной сцене">
            <Icon name="window" size={12} /> Все мониторы · внутри вкладки
          </span>
        )}
        <button
          className="btn btn--sm"
          title="Переподключить сессию заново"
          onClick={() => void reconnectTab(tab.sessionId)}
        >
          <Icon name="refresh" size={13} />
        </button>
      </div>
      {rdpEngine === 'iron' ? (
        <div className="iron-rdp-stage">
          <IronRdpView
            sessionId={tab.sessionId}
            host={host?.host ?? ''}
            port={host?.port ?? 3389}
            domain={host?.rdp.domain ?? ''}
            credentialId={host?.credentialId ?? null}
            width={rdpWidth}
            height={rdpHeight}
          />
          {tab.state.phase !== 'connected' && (
            <div
              className={`iron-rdp-overlay${tab.state.phase === 'error' ? ' iron-rdp-overlay--error' : ''}`}
            >
              {tab.state.phase === 'connecting' ? (
                <>
                  <Icon name="spinner" size={30} className="icon-spin" />
                  <span>Подключение через IronRDP…</span>
                </>
              ) : (
                <span>
                  {tab.state.phase === 'error'
                    ? ((tab.state as { message?: string }).message ?? 'Ошибка RDP')
                    : ((tab.state as { reason?: string }).reason ?? 'Сессия завершена')}
                </span>
              )}
            </div>
          )}
        </div>
      ) : rdpEngine === 'legacy' ? (
        <div className="iron-rdp-stage">
          {host && <LegacyRdpView sessionId={tab.sessionId} host={host} active={active} />}
          {tab.state.phase !== 'connected' && (
            <div
              className={`iron-rdp-overlay${tab.state.phase === 'error' ? ' iron-rdp-overlay--error' : ''}`}
            >
              {tab.state.phase === 'connecting' ? (
                <>
                  <Icon name="spinner" size={30} className="icon-spin" />
                  <span>Подключение через системный RDP…</span>
                </>
              ) : (
                <span>
                  {tab.state.phase === 'error'
                    ? ((tab.state as { message?: string }).message ?? 'Ошибка RDP')
                    : ((tab.state as { reason?: string }).reason ?? 'Сессия завершена')}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <RdpCanvas sessionId={tab.sessionId} width={rdpWidth} height={rdpHeight} connected={tab.state.phase === 'connected'} />
      )}
    </div>
  );
}

/** Смешивает hex-цвет с белым (для hover-варианта акцента). */
function mixWithWhite(hex: string, ratio: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number): number => Math.round(c + (255 - c) * ratio);
  return `#${((mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).padStart(6, '0')}`;
}

/** Смешивает hex-цвет с чёрным. */
function mixWithBlack(hex: string, ratio: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number): number => Math.round(c * (1 - ratio));
  return `#${((mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).padStart(6, '0')}`;
}

/** Hover-фон акцента: тёмный акцент затемняем, светлый осветляем. */
function accentHover(hex: string): string {
  return relativeLuminance(hex) > 0.3 ? mixWithWhite(hex, 0.18) : mixWithBlack(hex, 0.1);
}

/** Относительная яркость цвета по WCAG (0..1). */
function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = linear((n >> 16) & 255);
  const g = linear((n >> 8) & 255);
  const b = linear(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Цвет текста поверх акцентного фона: белый, пока контраст ≥ 3:1 (WCAG 1.4.11),
 * иначе почти чёрный. Светлые акценты (жёлтый, циан, фиолетовый) получают тёмный текст.
 */
function accentFg(hex: string): string {
  // Белый даёт 3:1, когда яркость акцента ≤ 0.30 (1.05/(L+0.05) ≥ 3).
  return relativeLuminance(hex) > 0.3 ? '#141519' : '#ffffff';
}

function PlaceholderPane({ tab }: { tab: { kind: string; protocol: string; title: string } }): React.JSX.Element {
  const names: Record<string, string> = {};
  return (
    <div className="placeholder-panel">
      <div className="placeholder-icon">
        <Icon name="code" size={44} />
      </div>
      <p>{names[tab.kind] ?? 'Этот тип сессии ещё не реализован'}</p>
      <p className="placeholder-muted">{tab.title}</p>
    </div>
  );
}
