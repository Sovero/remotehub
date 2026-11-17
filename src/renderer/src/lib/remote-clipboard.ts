import { dispatchRemoteCopy, formatBytes } from '@shared/clipboard-policy';
import { useApp } from '../store';
import { copyTextToClipboard } from './clipboard';

/**
 * Текст с удалённой сессии → локальный буфер обмена.
 *
 * Одна точка для SSH (OSC 52), RDP (cliprdr) и VNC (extended clipboard): политика
 * «разрешить / спрашивать / запретить» и предел размера берутся из настроек в
 * момент события, поэтому смена настройки действует сразу.
 *
 * @param source откуда текст — показывается в диалоге подтверждения.
 */
export function offerRemoteClipboard(text: string, source: string): void {
  const { clipboardPolicy, clipboardMaxBytes } = useApp.getState().settings;
  dispatchRemoteCopy(clipboardPolicy, clipboardMaxBytes, text, source, {
    copy: copyTextToClipboard,
    ask: (request) => useApp.getState().enqueueClipboardRequest(request),
    tooLarge: (limit) =>
      useApp.getState().pushToast(`Буфер обмена: текст больше предела ${formatBytes(limit)} — не скопирован`)
  });
}
