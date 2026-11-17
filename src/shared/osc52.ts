/**
 * OSC 52 — «положи это в буфер обмена клиента» изнутри SSH-сессии
 * (tmux set-clipboard, vim/nvim +clipboard, mc, screen).
 *
 * Последовательность приходит от удалённого сервера, поэтому клиент сам решает,
 * писать ли её в системный буфер: по умолчанию спрашиваем пользователя, а размер
 * ограничиваем, чтобы сервер не мог затереть буфер мегабайтами мусора.
 * Значения по умолчанию для настроек — рядом с полями `Settings` в `types.ts`.
 */
import type { Osc52Policy } from './types';

/**
 * Разбор данных OSC 52: "<selection>;<base64>".
 * selection 'c' — системный буфер. Возвращает текст или null, если запись не про
 * системный буфер, содержимое запрашивают ('?') или base64 битый: чтение буфера
 * сервером не поддерживаем — это утечка, а не копирование.
 */
export function parseOsc52(data: string): string | null {
  const semi = data.indexOf(';');
  if (semi < 0) return null;
  const selection = data.slice(0, semi).trim() || 'c';
  const payload = data.slice(semi + 1).trim();
  if (selection !== 'c' || !payload || payload === '?') return null;
  try {
    const bin = atob(payload);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    // некорректный base64 — последовательность просто игнорируем
    return null;
  }
}

/** Размер текста в байтах UTF-8 — по нему считается предел. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Что делать с текстом из OSC 52. */
export type Osc52Action = 'copy' | 'ask' | 'ignore' | 'too-large';

/**
 * Что делать с текстом из OSC 52.
 *
 * maxBytes <= 0 — без ограничения. Превышение предела блокирует запись даже в
 * режиме 'ask': защита от заливки буфера работает до вопроса, а не после.
 */
export function osc52Action(policy: Osc52Policy, maxBytes: number, text: string): Osc52Action {
  if (!text || policy === 'deny') return 'ignore';
  if (maxBytes > 0 && utf8Length(text) > maxBytes) return 'too-large';
  return policy === 'allow' ? 'copy' : 'ask';
}

/** Сколько строк и символов в строке показываем в подтверждении. */
export const OSC52_PREVIEW_LINES = 4;
export const OSC52_PREVIEW_LINE_CHARS = 120;

/**
 * Первые строки текста OSC 52 для подтверждения. Каждая строка режется отдельно:
 * одна длинная строка (лог, JSON) иначе раздула бы модалку и DOM.
 */
export function osc52Preview(text: string): string {
  const all = text.split('\n');
  const head = all.slice(0, OSC52_PREVIEW_LINES).map(clipPreviewLine).join('\n');
  return all.length > OSC52_PREVIEW_LINES ? `${head}\n…` : head;
}

/** Строка предпросмотра: длинную режем, многоточие показывает обрыв. */
function clipPreviewLine(line: string): string {
  return line.length > OSC52_PREVIEW_LINE_CHARS ? `${line.slice(0, OSC52_PREVIEW_LINE_CHARS)}…` : line;
}

/** Данные подтверждения записи в буфер (политика «спрашивать»). */
export interface Osc52AskRequest {
  /** Полный текст: им и запишется буфер, если пользователь согласится. */
  text: string;
  /** Размер в байтах UTF-8 — показывается в модалке. */
  bytes: number;
  /** Обрезанные первые строки для предпросмотра. */
  preview: string;
}

/** Что сделать по решению политики. */
export interface Osc52Effects {
  /** Записать текст в буфер обмена. */
  copy(text: string): void;
  /** Показать подтверждение — в буфер пока ничего не пишется. */
  ask(request: Osc52AskRequest): void;
  /** Текст больше предела: не пишем и сообщаем предел. */
  tooLarge(maxBytes: number): void;
}

/**
 * Применить политику OSC 52: единственное место, где решение превращается в
 * действие. Вынесено из компонента, чтобы путь «спрашивать» проверялся тестом
 * без React: `ask` обязан заполнить данные модалки и не трогать буфер.
 * @returns принятое решение — для журнала и тестов.
 */
export function dispatchOsc52(
  policy: Osc52Policy,
  maxBytes: number,
  text: string,
  effects: Osc52Effects
): Osc52Action {
  const action = osc52Action(policy, maxBytes, text);
  if (action === 'copy') effects.copy(text);
  else if (action === 'ask') effects.ask({ text, bytes: utf8Length(text), preview: osc52Preview(text) });
  else if (action === 'too-large') effects.tooLarge(maxBytes);
  // 'ignore' — запись запрещена настройками, ничего не показываем и не пишем
  return action;
}

/** Размер для подписей: «512 Б», «1.5 КБ», «2.0 МБ». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
