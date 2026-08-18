import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import 'xterm/css/xterm.css';
import { registerTermPaste } from '../lib/termRegistry';
import { useApp, type SessionTab } from '../store';

const DARK_THEME = {
  background: '#101014',
  foreground: '#e6e6e6',
  cursor: '#e6e6e6',
  selectionBackground: 'rgba(45, 149, 236, 0.35)',
  black: '#101014',
  red: '#e5534b',
  green: '#57ab5a',
  yellow: '#d29922',
  blue: '#2d95ec',
  magenta: '#c678dd',
  cyan: '#39c5cf',
  white: '#e6e6e6',
  brightBlack: '#5c5c66',
  brightRed: '#ff6b61',
  brightGreen: '#6ecb71',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#d19aec',
  brightCyan: '#56d4dd',
  brightWhite: '#ffffff'
};

const LIGHT_THEME = {
  background: '#f7f7f5',
  foreground: '#1c1c1e',
  cursor: '#1c1c1e',
  selectionBackground: 'rgba(45, 149, 236, 0.25)',
  black: '#1c1c1e',
  red: '#d1242f',
  green: '#2d8a3e',
  yellow: '#a05a00',
  blue: '#1a6fc4',
  magenta: '#8a3fa0',
  cyan: '#007a86',
  white: '#f7f7f5',
  brightBlack: '#8a8a93',
  brightRed: '#e5534b',
  brightGreen: '#57ab5a',
  brightYellow: '#d29922',
  brightBlue: '#2d95ec',
  brightMagenta: '#c678dd',
  brightCyan: '#39c5cf',
  brightWhite: '#ffffff'
};

export default function TerminalPane({
  tab,
  active
}: {
  tab: SessionTab;
  active: boolean;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const theme = useApp((s) => s.settings.theme);
  const fontSize = useApp((s) => s.settings.fontSize);
  const fontFamily = useApp((s) => s.settings.fontFamily);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Создание терминала
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontSize,
      fontFamily,
      theme: theme === 'dark' ? DARK_THEME : LIGHT_THEME,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;
    term.open(container);
    try {
      fit.fit();
    } catch {
      // контейнер мог быть скрыт
    }

    const unsubscribeData = window.api.onSessionData((payload) => {
      if (payload.sessionId === tab.sessionId) {
        term.write(payload.data);
      }
    });

    const disposeInput = term.onData((data) => {
      window.api.sessionInput(tab.sessionId, btoaUnicode(data));
    });

    const unregisterPaste = registerTermPaste(tab.sessionId, (text) => term.paste(text));

    return () => {
      disposeInput.dispose();
      unregisterPaste();
      unsubscribeData();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.sessionId]);

  // Живое применение шрифта и темы
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    term.options.fontFamily = fontFamily;
    term.options.theme = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
  }, [fontSize, fontFamily, theme]);

  // Копирование/вставка
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onKeyDown = (e: KeyboardEvent): void => {
      const term = termRef.current;
      if (!term) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        const sel = term.getSelection();
        if (sel) {
          void navigator.clipboard.writeText(sel);
          term.clearSelection();
        }
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        void navigator.clipboard.readText().then((text) => term.paste(text));
        e.preventDefault();
      }
    };
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
      void navigator.clipboard.readText().then((text) => termRef.current?.paste(text));
    };
    container.addEventListener('keydown', onKeyDown);
    container.addEventListener('contextmenu', onContextMenu);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      container.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  // Адаптация размера при активации вкладки и изменении размера окна
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // контейнер скрыт
      }
    }, 30);
    return () => window.clearTimeout(id);
  }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      if (active) {
        try {
          fitRef.current?.fit();
        } catch {
          // контейнер скрыт
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [active]);

  // Передача размера в main при изменении
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      const term = termRef.current;
      if (term) {
        window.api.sessionResize(tab.sessionId, term.cols, term.rows);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [active, tab.sessionId]);

  // Ctrl+F — поиск по активной вкладке
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const runSearch = useCallback(
    (dir: 1 | -1): void => {
      const search = searchRef.current;
      if (!search || !searchQuery) return;
      if (dir === 1) search.findNext(searchQuery);
      else search.findPrevious(searchQuery);
    },
    [searchQuery]
  );

  return (
    <div className="terminal-wrap">
      <div className={`terminal-pane${active ? '' : ' terminal-pane--hidden'}`} ref={containerRef} />
      {searchOpen && active && (
        <div className="term-search">
          <input
            className="input term-search-input"
            placeholder="Поиск в выводе…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch(1);
              if (e.key === 'Escape') setSearchOpen(false);
            }}
            autoFocus
          />
          <button className="btn btn--sm" onClick={() => runSearch(-1)} title="Назад (Shift+Enter)">
            ↑
          </button>
          <button className="btn btn--sm" onClick={() => runSearch(1)} title="Далее (Enter)">
            ↓
          </button>
          <button className="btn btn--sm" onClick={() => setSearchOpen(false)} title="Закрыть (Esc)">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

/** base64-кодирование юникода (btoa не умеет >1 байт). */
function btoaUnicode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
