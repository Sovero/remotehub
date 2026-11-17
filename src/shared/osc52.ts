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

/** Размер для подписей: «512 Б», «1.5 КБ», «2.0 МБ». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
