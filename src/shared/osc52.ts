/**
 * OSC 52 — «положи это в буфер обмена клиента» изнутри SSH-сессии
 * (tmux set-clipboard, vim/nvim +clipboard, mc, screen).
 *
 * Здесь только разбор последовательности: писать ли текст в буфер, решает общая
 * политика буфера обмена (`clipboard-policy.ts`).
 */

/**
 * Разбор данных OSC 52: "<selection>;<base64>".
 *
 * selection 'c' — системный буфер, пустое поле tmux тоже означает его. Возвращает
 * текст или null, если запись не про системный буфер, содержимое запрашивают ('?')
 * или base64 битый: чтение буфера сервером не поддерживаем — это утечка, а не
 * копирование.
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
