import { createHost, type Host } from './types';

export type QuickConnectResult = { ok: true; host: Host } | { ok: false; error: string };

/**
 * Разбирает строку быстрого подключения: `user@host`, `user@host:2222`,
 * `host`, `host:2222`. IPv6 — в квадратных скобках: `[::1]:22`.
 */
export function parseQuickConnect(raw: string): QuickConnectResult {
  const input = raw.trim();
  if (!input) return { ok: false, error: 'Пустая строка' };

  let rest = input;
  let username = '';
  const at = rest.lastIndexOf('@');
  if (at !== -1) {
    username = rest.slice(0, at).trim();
    rest = rest.slice(at + 1).trim();
    if (username === '') return { ok: false, error: 'Пустое имя пользователя' };
  }

  let hostPart = rest;
  let portPart: string | null = null;
  if (rest.startsWith('[')) {
    // IPv6 в скобках: [::1] или [::1]:22
    const close = rest.indexOf(']');
    if (close === -1) return { ok: false, error: 'Незакрытая скобка в адресе' };
    hostPart = rest.slice(1, close);
    const after = rest.slice(close + 1);
    if (after === '') {
      // ок
    } else if (after.startsWith(':')) {
      portPart = after.slice(1);
    } else {
      return { ok: false, error: 'Некорректный адрес' };
    }
  } else {
    const colon = rest.lastIndexOf(':');
    if (colon !== -1) {
      const maybePort = rest.slice(colon + 1);
      if (/^\d+$/.test(maybePort)) {
        hostPart = rest.slice(0, colon);
        portPart = maybePort;
      } else if (rest.indexOf(':') !== rest.lastIndexOf(':')) {
        // Несколько двоеточий — похоже на IPv6 без скобок, принимаем целиком.
        hostPart = rest;
      } else {
        return { ok: false, error: `Некорректный порт: ${maybePort}` };
      }
    }
  }

  if (hostPart === '') return { ok: false, error: 'Не указан адрес хоста' };

  let port = 22;
  if (portPart !== null) {
    const n = Number(portPart);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      return { ok: false, error: `Некорректный порт: ${portPart}` };
    }
    port = n;
  }

  return {
    ok: true,
    host: createHost({
      name: input.length > 40 ? `${input.slice(0, 40)}…` : input,
      protocol: 'ssh',
      host: hostPart,
      port,
      username
    })
  };
}
