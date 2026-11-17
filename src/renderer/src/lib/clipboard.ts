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
