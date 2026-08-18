/** Сопоставление sessionId → функция вставки текста в терминал. */
const pasters = new Map<string, (text: string) => void>();

export function registerTermPaste(sessionId: string, fn: (text: string) => void): () => void {
  pasters.set(sessionId, fn);
  return () => {
    pasters.delete(sessionId);
  };
}

export function pasteToTerminal(sessionId: string, text: string): boolean {
  const fn = pasters.get(sessionId);
  if (!fn) return false;
  fn(text);
  return true;
}
