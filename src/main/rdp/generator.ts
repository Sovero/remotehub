import type { Host } from '../../shared/types';

export interface RdpFileOptions {
  host: string;
  port: number;
  username: string;
  domain: string;
  /** Профильный режим; фактический запуск всегда нормализуется для embed. */
  screenMode: 'window' | 'fullscreen';
  width: number;
  height: number;
  /** Профильная настройка; несколько top-level окон в embedded-режиме запрещены. */
  multiMonitor: boolean;
  promptForCreds: boolean;
}

export function rdpOptionsFromHost(host: Host): RdpFileOptions {
  return {
    host: host.host,
    port: host.port ?? 3389,
    username: host.username || '',
    domain: host.rdp?.domain ?? '',
    screenMode: host.rdp?.multiMonitor ? 'fullscreen' : (host.rdp?.screenMode ?? 'window'),
    width: host.rdp?.width ?? 1280,
    height: host.rdp?.height ?? 800,
    multiMonitor: host.rdp?.multiMonitor ?? false,
    promptForCreds: host.rdp?.promptForCreds ?? false
  };
}

/**
 * Преобразует профильные display-настройки в параметры одной embedded-сцены.
 * mstsc с screen mode id=1/use multimon создаёт top-level окно или несколько
 * окон, поэтому эти два флага нельзя передавать во встроенный клиент.
 */
export function toEmbeddedRdpOptions(opts: RdpFileOptions): RdpFileOptions {
  const width = Number.isFinite(opts.width) ? Math.round(opts.width) : 1280;
  const height = Number.isFinite(opts.height) ? Math.round(opts.height) : 800;
  return {
    ...opts,
    screenMode: 'window',
    multiMonitor: false,
    width: Math.max(320, width),
    height: Math.max(200, height)
  };
}

/** Генерирует embedded-safe содержимое .rdp-файла по настройкам профиля. */
export function buildRdpFile(opts: RdpFileOptions): string {
  const embedded = toEmbeddedRdpOptions(opts);
  const lines: string[] = [];

  // Всегда одна оконная сцена: полноэкранность и multi-monitor реализуются
  // оболочкой вкладки, а не отдельным окном mstsc.
  lines.push('screen mode id:i:2');
  lines.push('use multimon:i:0');
  lines.push(`desktopwidth:i:${embedded.width}`);
  lines.push(`desktopheight:i:${embedded.height}`);
  lines.push('session bpp:i:32');
  lines.push('winposstr:s:0,1,0,0,800,600');
  lines.push(`full address:s:${embedded.host}`);
  lines.push(`server port:i:${embedded.port}`);
  if (embedded.username) lines.push(`username:s:${embedded.username}`);
  if (embedded.domain) lines.push(`domain:s:${embedded.domain}`);
  lines.push('authentication level:i:0');
  lines.push(`prompt for credentials on client:i:${embedded.promptForCreds ? 1 : 0}`);
  lines.push('redirectclipboard:i:1');
  lines.push('redirect printers:i:0');
  lines.push('redirectcomports:i:0');
  lines.push('alternate shell:s:');
  lines.push('shell working directory:s:');
  lines.push('disable fullscreen winpos:i:1');
  return lines.join('\r\n') + '\r\n';
}
