/**
 * Буфер обмена приложения.
 *
 * navigator.clipboard требует фокуса документа: когда фокус у canvas RDP-сессии
 * или у встроенного нативного окна, writeText/readText падают с «Document is not
 * focused», и копирование из сессии молча не работает. Поэтому буфер обмена
 * всегда идёт через нативный clipboard главного процесса.
 */
export function copyTextToClipboard(text: string): void {
  if (text) void window.api.clipboardWrite(text);
}

/** Текст из буфера обмена (пустая строка, если буфер пуст). */
export async function readClipboardText(): Promise<string> {
  return (await window.api.clipboardRead()).text;
}

/** Как часто сверяем локальный буфер, чтобы сессия видела свежую вставку. */
export const CLIPBOARD_POLL_MS = 700;

export interface ClipboardSyncOptions {
  /** Отдать текст удалённой сессии (cliprdr в RDP, clipboardPasteFrom в VNC). */
  push: (text: string) => void;
  /** Можно ли синхронизировать сейчас: сессия открыта и подключена. */
  isReady?: () => boolean;
  /** Чтение локального буфера; подменяется в тестах. */
  read?: () => Promise<string>;
}

export interface ClipboardSync {
  /**
   * Локальный буфер → сессия. Повторно тот же текст не отправляется, текст,
   * пришедший с сервера, обратно не возвращается. force — ответ на запрос
   * сервера: там нужен именно текущий текст, даже если он уже отправлялся.
   * @returns true, если текст действительно ушёл в сессию.
   */
  pushLocal(text: string, force?: boolean): boolean;
  /** Прочитать локальный буфер и отправить его в сессию. */
  pushCurrent(force?: boolean): Promise<void>;
  /** Пришло с сервера: запомнить (чтобы не вернуть обратно) и положить локально. */
  applyRemote(text: string): void;
  /** Запустить опрос локального буфера. @returns остановка опроса. */
  start(): () => void;
}

/**
 * Синхронизация буфера обмена с удалённой сессией в обе стороны.
 *
 * Сессии (RDP через cliprdr, VNC через extended clipboard) не присылают
 * событий о копировании внутри себя в локальный буфер сами и не забирают
 * локальный без запроса, поэтому: сервер → локально идёт событием сессии
 * (`applyRemote`), локально → сервер — опросом (`start`), а два последних
 * значения держатся здесь, чтобы текст не гулял по кругу бесконечно.
 */
export function createClipboardSync(options: ClipboardSyncOptions): ClipboardSync {
  const { push, isReady = () => true, read = readClipboardText } = options;
  /** Последнее отправленное в сессию и последнее полученное из неё. */
  let sent = '';
  let received = '';

  const pushLocal = (text: string, force = false): boolean => {
    if (!text || !isReady()) return false;
    if (!force) {
      if (text === received) {
        // Текст пришёл с сервера — обратно его не отправляем.
        sent = text;
        return false;
      }
      if (text === sent) return false;
    }
    sent = text;
    push(text);
    return true;
  };

  const pushCurrent = async (force = false): Promise<void> => {
    pushLocal(await read(), force);
  };

  const applyRemote = (text: string): void => {
    if (!text) return;
    // Помечаем как полученное с сервера: иначе опрос отправил бы текст назад.
    received = text;
    sent = text;
    copyTextToClipboard(text);
  };

  const start = (): (() => void) => {
    const tick = (): void => {
      // В фоне окно не в фокусе — читать буфер незачем, а на Windows это ещё и
      // дёргает системный буфер без пользы для сессии.
      if (!isReady() || !document.hasFocus()) return;
      void pushCurrent();
    };
    const id = window.setInterval(tick, CLIPBOARD_POLL_MS);
    return () => window.clearInterval(id);
  };

  return { pushLocal, pushCurrent, applyRemote, start };
}
