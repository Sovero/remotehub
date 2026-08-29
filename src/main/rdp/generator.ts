import type { Host } from '../../shared/types';

export interface RdpFileOptions {
  host: string;
  port: number;
  username: string;
  domain: string;
  width: number;
  height: number;
  promptForCreds: boolean;
}

export function rdpOptionsFromHost(host: Host): RdpFileOptions {
  return {
    host: host.host,
    port: host.port ?? 3389,
    username: host.username || '',
    domain: host.rdp?.domain ?? '',
    width: host.rdp?.width ?? 1280,
    height: host.rdp?.height ?? 800,
    promptForCreds: host.rdp?.promptForCreds ?? false
  };
}
