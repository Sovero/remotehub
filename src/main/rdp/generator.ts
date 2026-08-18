import type { Host } from '../../shared/types';

export interface RdpFileOptions {
  host: string;
  port: number;
  username: string;
  domain: string;
  screenMode: 'window' | 'fullscreen';
  width: number;
  height: number;
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

/** Генерирует содержимое .rdp-файла по настройкам профиля. */
export function buildRdpFile(opts: RdpFileOptions): string {
  const lines: string[] = [];
  const fullscreen = opts.multiMonitor || opts.screenMode === 'fullscreen';

  lines.push(`screen mode id:i:${fullscreen ? 1 : 2}`);
  lines.push(`use multimon:i:${opts.multiMonitor ? 1 : 0}`);
  if (!fullscreen) {
    lines.push(`desktopwidth:i:${opts.width}`);
    lines.push(`desktopheight:i:${opts.height}`);
  }
  lines.push('session bpp:i:32');
  lines.push('winposstr:s:0,1,0,0,800,600');
  lines.push(`full address:s:${opts.host}`);
  lines.push(`server port:i:${opts.port}`);
  if (opts.username) lines.push(`username:s:${opts.username}`);
  if (opts.domain) lines.push(`domain:s:${opts.domain}`);
  lines.push('authentication level:i:0');
  lines.push(`prompt for credentials on client:i:${opts.promptForCreds ? 1 : 0}`);
  lines.push('redirectclipboard:i:1');
  lines.push('redirect printers:i:0');
  lines.push('redirectcomports:i:0');
  lines.push('alternate shell:s:');
  lines.push('shell working directory:s:');
  lines.push('disable fullscreen winpos:i:1');
  return lines.join('\r\n') + '\r\n';
}
