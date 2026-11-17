/**
 * Политика буфера обмена для текста, приходящего из удалённых сессий:
 * SSH (OSC 52), RDP (канал cliprdr) и VNC (extended clipboard).
 *
 * Раньше такой текст молча попадал в буфер Windows — любой сервер мог подменить
 * его, в том числе мегабайтами мусора. Настройка общая для всех протоколов:
 * разрешить, спрашивать или запретить, плюс предел размера.
 */

/** 'allow' — копировать сразу, 'ask' — спросить, 'deny' — игнорировать. */
export type ClipboardPolicy = 'allow' | 'ask' | 'deny';

/** Предел размера текста из сессии по умолчанию: 100 КиБ. */
export const DEFAULT_CLIPBOARD_MAX_BYTES = 100_000;

/** Что делать с текстом из удалённой сессии. */
export type ClipboardDecision = 'copy' | 'ask' | 'ignore' | 'too-large';

/** Размер текста в байтах UTF-8 — по нему считается предел. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Что делать с текстом из удалённой сессии.
 *
 * maxBytes <= 0 — без ограничения. Превышение предела блокирует запись даже в
 * режиме 'ask': защита от заливки буфера работает до вопроса, а не после.
 */
export function clipboardDecision(policy: ClipboardPolicy, maxBytes: number, text: string): ClipboardDecision {
  if (!text || policy === 'deny') return 'ignore';
  if (maxBytes > 0 && utf8Length(text) > maxBytes) return 'too-large';
  return policy === 'allow' ? 'copy' : 'ask';
}

/** Сколько строк и символов в строке показываем в подтверждении. */
const PREVIEW_LINES = 4;
const PREVIEW_LINE_CHARS = 120;

/**
 * Первые строки текста для подтверждения. Каждая строка режется отдельно: одна
 * длинная строка (лог, JSON) иначе раздула бы диалог и DOM.
 */
export function clipboardPreview(text: string): string {
  const all = text.split('\n');
  const head = all.slice(0, PREVIEW_LINES).map(clipPreviewLine).join('\n');
  return all.length > PREVIEW_LINES ? `${head}\n…` : head;
}

/** Строка предпросмотра: длинную режем, многоточие показывает обрыв. */
function clipPreviewLine(line: string): string {
  return line.length > PREVIEW_LINE_CHARS ? `${line.slice(0, PREVIEW_LINE_CHARS)}…` : line;
}

/** Данные подтверждения записи в буфер обмена. */
export interface ClipboardAskRequest {
  /** Полный текст: им и запишется буфер, если пользователь согласится. */
  text: string;
  /** Размер в байтах UTF-8 — показывается в диалоге. */
  bytes: number;
  /** Обрезанные первые строки для предпросмотра. */
  preview: string;
  /** Откуда пришёл текст: «SSH · web-01», «RDP · 10.0.0.5», «VNC · сервер». */
  source: string;
}

/**
 * Поставить запрос в очередь подтверждений: новый встаёт в конец, а повтор того
 * же текста из того же источника подряд не дублируется.
 *
 * Очередь, а не одно поле: второй текст из сессии раньше молча затирал первый
 * вопрос, и пользователь терял шанс отказаться от чужого текста.
 * @returns тот же массив, если запрос — повтор: лишней перерисовки не будет.
 */
export function enqueueClipboardRequest(
  queue: ClipboardAskRequest[],
  request: ClipboardAskRequest
): ClipboardAskRequest[] {
  const last = queue[queue.length - 1];
  if (last && last.text === request.text && last.source === request.source) return queue;
  return [...queue, request];
}

/** Что сделать по решению политики. */
export interface ClipboardEffects {
  /** Записать текст в буфер обмена. */
  copy(text: string): void;
  /** Показать подтверждение — в буфер пока ничего не пишется. */
  ask(request: ClipboardAskRequest): void;
  /** Текст больше предела: не пишем и сообщаем предел. */
  tooLarge(maxBytes: number): void;
}

/**
 * Применить политику буфера: единственное место, где решение превращается в
 * действие. Вынесено из компонентов, чтобы путь «спрашивать» проверялся тестом
 * без React: `ask` обязан заполнить данные диалога и не трогать буфер.
 * @returns принятое решение — для журнала и тестов.
 */
export function dispatchRemoteCopy(
  policy: ClipboardPolicy,
  maxBytes: number,
  text: string,
  source: string,
  effects: ClipboardEffects
): ClipboardDecision {
  const decision = clipboardDecision(policy, maxBytes, text);
  if (decision === 'copy') effects.copy(text);
  else if (decision === 'ask')
    effects.ask({ text, bytes: utf8Length(text), preview: clipboardPreview(text), source });
  else if (decision === 'too-large') effects.tooLarge(maxBytes);
  // 'ignore' — запись запрещена настройками, ничего не показываем и не пишем
  return decision;
}

/** Размер для подписей: «512 Б», «1.5 КБ», «2.0 МБ». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
