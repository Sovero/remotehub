import { useEffect, useState } from 'react';
import { useApp } from '../store';
import Icon from './Icon';

/**
 * Кастомный заголовок безрамочного окна (frame: false в main).
 * Вся полоса — drag-зона ОС (-webkit-app-region: drag в CSS), кнопки —
 * no-drag. Двойной клик по полосе — развернуть/восстановить, как у нативного
 * заголовка Windows.
 */
export default function TitleBar(): React.JSX.Element {
  const appInfo = useApp((s) => s.appInfo);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.api.windowIsMaximized?.().then((res) => {
      if (alive) setMaximized(!!res?.maximized);
    });
    const off = window.api.onWindowMaximizeChanged?.((payload) => {
      setMaximized(!!payload?.maximized);
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  const toggleMaximize = (): void => {
    void window.api.windowToggleMaximize?.();
  };

  return (
    <header
      className="titlebar"
      onDoubleClick={(e) => {
        // Клик по кнопкам не должен разворачивать окно.
        if ((e.target as HTMLElement).closest?.('.titlebar-controls')) return;
        toggleMaximize();
      }}
    >
      <div className="titlebar-title">
        <span className="titlebar-name">Remote Hub</span>
        {appInfo?.version ? <span className="titlebar-version">v{appInfo.version}</span> : null}
      </div>
      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-btn"
          title="Свернуть"
          aria-label="Свернуть окно"
          onClick={() => void window.api.windowMinimize?.()}
        >
          <Icon name="minus" size={13} />
        </button>
        <button
          type="button"
          className="titlebar-btn"
          title={maximized ? 'Восстановить' : 'Развернуть'}
          aria-label={maximized ? 'Восстановить окно' : 'Развернуть окно'}
          onClick={toggleMaximize}
        >
          <Icon name={maximized ? 'restore' : 'expand'} size={13} />
        </button>
        <button
          type="button"
          className="titlebar-btn titlebar-btn--close"
          title="Закрыть"
          aria-label="Закрыть окно"
          onClick={() => void window.api.windowClose?.()}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
    </header>
  );
}
