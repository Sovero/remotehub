import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import 'xterm/css/xterm.css';
import { formatBytes, osc52Action, parseOsc52, utf8Length } from '@shared/osc52';
import { copyTextToClipboard, readClipboardText } from '../lib/clipboard';
import { registerTermPaste } from '../lib/termRegistry';
import { useApp, type SessionTab } from '../store';
import Icon from './Icon';
import Modal from './dialogs/Modal';

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
  const pushToast = useApp((s) => s.pushToast);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  /** Многострочная вставка, ждущая решения пользователя. */
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  /** Текст из OSC 52, ждущий подтверждения (политика «спрашивать»). */
  const [pendingOsc52, setPendingOsc52] = useState<PendingOsc52 | null>(null);

  /**
   * Вставка с защитой от пачки команд: одна строка уходит в терминал сразу, а
   * многострочный текст сначала спрашивает режим — иначе вставка выполнила бы
   * на сервере все строки подряд.
   */
  const requestPaste = useCallback((text: string): void => {
    const lines = splitPasteLines(text);
    if (lines.length <= 1) {
      termRef.current?.paste(toTerminalInput(text));
      return;
    }
    setPendingPaste({ text, lines, index: 0, step: false });
  }, []);

  /**
   * OSC 52: сервер просит записать текст в буфер клиента (tmux set-clipboard,
   * vim +clipboard, mc). Раньше копировали всегда и без предела — любой сервер
   * молча подменял буфер Windows. Теперь решает настройка, а слишком большой
   * текст в буфер не попадает вовсе.
   */
  const requestOsc52Copy = useCallback(
    (text: string): void => {
      const { osc52Policy, osc52MaxBytes } = useApp.getState().settings;
      switch (osc52Action(osc52Policy, osc52MaxBytes, text)) {
        case 'copy':
          copyTextToClipboard(text);
          return;
        case 'ask':
          setPendingOsc52({ text, bytes: utf8Length(text) });
          return;
        case 'too-large':
          pushToast(`OSC 52: текст больше предела ${formatBytes(osc52MaxBytes)} — буфер не изменён`);
          return;
        default:
          // 'ignore' — запись запрещена настройками, молча пропускаем
          return;
      }
    },
    [pushToast]
  );

  const pasteEverything = (): void => {
    if (!pendingPaste) return;
    termRef.current?.paste(toTerminalInput(pendingPaste.text));
    setPendingPaste(null);
  };

  /** Построчный режим: каждая строка уходит в терминал только по подтверждению. */
  const pasteNextLine = (): void => {
    const pending = pendingPaste;
    if (!pending) return;
    termRef.current?.paste(pending.lines[pending.index] + '\r');
    const next = pending.index + 1;
    setPendingPaste(next >= pending.lines.length ? null : { ...pending, index: next });
  };

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
    // OSC 52 — штатный способ «скопировать в буфер клиента» изнутри удалённой
    // сессии (tmux set-clipboard, vim/nvim +clipboard, mc, screen, ssh-сессии
    // через far2l). Без обработчика xterm.js молча проглатывает эту
    // последовательность, поэтому копирование на сервере не доходило до
    // буфера Windows. Писать ли в буфер — решает политика в настройках.
    const oscClipboard = term.parser.registerOscHandler(52, (data: string) => {
      const text = parseOsc52(data);
      if (text !== null) requestOsc52Copy(text);
      return true;
    });
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
        term.write(atobBytes(payload.data));
      }
    });

    const disposeInput = term.onData((data) => {
      window.api.sessionInput(tab.sessionId, btoaUnicode(data));
    });

    const unregisterPaste = registerTermPaste(tab.sessionId, requestPaste);

    return () => {
      disposeInput.dispose();
      unregisterPaste();
      unsubscribeData();
      oscClipboard.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.sessionId, requestPaste, requestOsc52Copy]);

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
        copySelection(term);
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        void readClipboardText().then(requestPaste);
        e.preventDefault();
      }
    };
    // Правая кнопка: есть выделение — копируем его (как в Termius/PuTTY),
    // нет выделения — вставляем. Раньше клик всегда вставлял, и выделенный
    // текст нельзя было скопировать мышью.
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
      const term = termRef.current;
      if (!term) return;
      if (copySelection(term)) return;
      void readClipboardText().then(requestPaste);
    };
    container.addEventListener('keydown', onKeyDown);
    container.addEventListener('contextmenu', onContextMenu);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      container.removeEventListener('contextmenu', onContextMenu);
    };
  }, [requestPaste]);

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
          <button className="btn btn--sm btn--icon" onClick={() => runSearch(-1)} title="Назад (Shift+Enter)">
            <Icon name="chevron-up" size={13} />
          </button>
          <button className="btn btn--sm btn--icon" onClick={() => runSearch(1)} title="Далее (Enter)">
            <Icon name="chevron-down" size={13} />
          </button>
          <button className="btn btn--sm btn--icon" onClick={() => setSearchOpen(false)} title="Закрыть (Esc)">
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
      {pendingOsc52 && (
        <Modal title="Скопировать в буфер обмена?" onClose={() => setPendingOsc52(null)} width={460}>
          <div className="form">
            <div className="form-row">
              <label className="form-label">
                «{tab.title}» просит записать в буфер обмена {formatBytes(pendingOsc52.bytes)} текста.
              </label>
              <code className="input" style={PASTE_PREVIEW_STYLE}>
                {osc52Preview(pendingOsc52.text)}
              </code>
            </div>
            <div className="form-hint">
              Политику можно сменить в настройках: разрешить, спрашивать или запретить.
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setPendingOsc52(null)}>
                <Icon name="close" size={13} /> Не копировать
              </button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  copyTextToClipboard(pendingOsc52.text);
                  setPendingOsc52(null);
                }}
              >
                <Icon name="check" size={13} /> Скопировать
              </button>
            </div>
          </div>
        </Modal>
      )}
      {pendingPaste && (
        <Modal title="Вставка нескольких строк" onClose={() => setPendingPaste(null)} width={460}>
          <div className="form">
            {pendingPaste.step ? (
              <>
                <div className="form-row">
                  <label className="form-label">
                    Строка {pendingPaste.index + 1} из {pendingPaste.lines.length}
                  </label>
                  <code className="input" style={PASTE_PREVIEW_STYLE}>
                    {pendingPaste.lines[pendingPaste.index] || '(пустая строка)'}
                  </code>
                </div>
                <div className="modal-actions">
                  <button className="btn" onClick={() => setPendingPaste(null)}>
                    <Icon name="close" size={13} /> Отменить
                  </button>
                  <button className="btn btn--primary" onClick={pasteNextLine}>
                    <Icon name="play" size={13} /> Вставить строку
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="form-row">
                  <label className="form-label">
                    В буфере {pendingPaste.lines.length} строк — вставка выполнит все команды на сервере сразу.
                  </label>
                  <code className="input" style={PASTE_PREVIEW_STYLE}>
                    {pastePreview(pendingPaste.lines)}
                  </code>
                </div>
                <div className="modal-actions">
                  <button className="btn" onClick={() => setPendingPaste(null)}>
                    <Icon name="close" size={13} /> Отменить
                  </button>
                  <button className="btn" onClick={pasteEverything}>
                    <Icon name="code" size={13} /> Вставить всё
                  </button>
                  <button
                    className="btn btn--primary"
                    onClick={() => setPendingPaste((p) => (p ? { ...p, step: true } : p))}
                  >
                    <Icon name="play" size={13} /> Построчно
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Многострочная вставка, ждущая решения: всё сразу или по одной строке. */
interface PendingPaste {
  /** Исходный текст буфера — им вставляется режим «Вставить всё». */
  text: string;
  lines: string[];
  /** Индекс следующей строки для построчного режима. */
  index: number;
  /** true — построчная вставка с подтверждением каждой строки. */
  step: boolean;
}

/** Текст из OSC 52, ждущий решения пользователя (политика «спрашивать»). */
interface PendingOsc52 {
  text: string;
  bytes: number;
}

/** Сколько строк и символов в строке показываем в подтверждении. */
const OSC52_PREVIEW_LINES = 4;
const OSC52_PREVIEW_LINE_CHARS = 120;

/**
 * Первые строки текста OSC 52 для подтверждения. Каждая строка режется отдельно:
 * одна длинная строка (лог, JSON) иначе раздула бы модалку и DOM.
 */
function osc52Preview(text: string): string {
  const all = text.split('\n');
  const head = all.slice(0, OSC52_PREVIEW_LINES).map(clipPreviewLine).join('\n');
  return all.length > OSC52_PREVIEW_LINES ? `${head}\n…` : head;
}

/** Строка предпросмотра: длинную режем, многоточие показывает обрыв. */
function clipPreviewLine(line: string): string {
  return line.length > OSC52_PREVIEW_LINE_CHARS ? `${line.slice(0, OSC52_PREVIEW_LINE_CHARS)}…` : line;
}

/** Блок предпросмотра вставляемого текста в диалоге. */
const PASTE_PREVIEW_STYLE: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  maxHeight: 140,
  overflow: 'auto'
};

/** Строки вставки; завершающий перевод строки отдельной строкой не считается. */
function splitPasteLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** LF → CR: в терминал Enter приходит как CR, и только он гарантированно выполняет команду. */
function toTerminalInput(text: string): string {
  return text.replace(/\r?\n/g, '\r');
}

/** Первые строки для предпросмотра. */
function pastePreview(lines: string[]): string {
  const head = lines.slice(0, 5).join('\n');
  return lines.length > 5 ? head + '\n…' : head;
}

/** Копирует текущее выделение терминала; false — выделения нет. */
function copySelection(term: Terminal): boolean {
  const sel = term.getSelection();
  if (!sel) return false;
  copyTextToClipboard(sel);
  term.clearSelection();
  return true;
}

/** base64-кодирование юникода (btoa не умеет >1 байт). */
function btoaUnicode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * base64 → сырые байты для xterm.write(). Байты, а не decoded-строка:
 * поток может разрезать многобайтовый UTF-8-символ между двумя чанками
 * IPC-сообщений, xterm сам буферизует незавершённые последовательности
 * на границах write() — decode здесь через TextDecoder потерял бы их.
 */
function atobBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
