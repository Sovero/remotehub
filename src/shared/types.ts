export type Protocol = 'ssh' | 'telnet' | 'rdp' | 'vnc';

export interface SshOptions {
  keepalive: number; // seconds, 0 = off
  agent: boolean; // use SSH agent for key auth
  timeout: number; // connection timeout, seconds
}

export interface RdpOptions {
  domain: string;
  screenMode: 'window' | 'fullscreen';
  width: number;
  height: number;
  multiMonitor: boolean;
  promptForCreds: boolean;
}

export interface VncOptions {
  scale: 'scale' | 'noscaled' | 'local';
  quality: number; // 0..9, 0 = auto
}

export interface Host {
  id: string;
  kind: 'host';
  name: string;
  protocol: Protocol;
  host: string;
  port: number | null;
  username: string;
  credentialId: string | null;
  tags: string[];
  notes: string;
  ssh: SshOptions;
  rdp: RdpOptions;
  vnc: VncOptions;
  lastConnectedAt: string | null;
}

export interface Group {
  id: string;
  kind: 'group';
  name: string;
  collapsed: boolean;
  children: TreeNode[];
}

export type TreeNode = Group | Host;

export interface CredentialSet {
  id: string;
  name: string;
  username: string;
  passwordMode: 'stored' | 'ask';
  passwordCipher: string | null;
  keyFile: string | null;
  keyPassphraseCipher: string | null;
  useAgent: boolean;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OpenTabMeta {
  sessionId: string;
  hostId: string | null;
  title: string;
  protocol: Protocol;
  kind: 'terminal' | 'vnc' | 'rdp' | 'sftp';
  adHocHost: Host | null;
}

export interface Settings {
  theme: 'dark' | 'light';
  fontSize: number;
  fontFamily: string;
  accent: string;
  confirmOnDelete: boolean;
  restoreTabs: boolean;
  winBounds: WindowBounds | null;
  openTabs: OpenTabMeta[];
}

export interface ProfilesFile {
  schemaVersion: number;
  tree: TreeNode[];
}

export interface SettingsFile {
  schemaVersion: number;
  settings: Settings;
}

export interface CredentialsFile {
  schemaVersion: number;
  sets: CredentialSet[];
}

export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  fontSize: 14,
  fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
  accent: '#2d95ec',
  confirmOnDelete: true,
  restoreTabs: true,
  winBounds: null,
  openTabs: []
};

export const DEFAULT_SSH: SshOptions = { keepalive: 30, agent: false, timeout: 10 };
export const DEFAULT_RDP: RdpOptions = {
  domain: '',
  screenMode: 'window',
  width: 1280,
  height: 800,
  multiMonitor: false,
  promptForCreds: false
};
export const DEFAULT_VNC: VncOptions = { scale: 'scale', quality: 6 };

export const DEFAULT_PROTOCOL_PORTS: Record<Protocol, number> = {
  ssh: 22,
  telnet: 23,
  rdp: 3389,
  vnc: 5900
};

export function defaultPort(protocol: Protocol): number {
  return DEFAULT_PROTOCOL_PORTS[protocol];
}

export function createHost(partial: Partial<Host> & { name: string; host: string; protocol: Protocol }): Host {
  return {
    id: partial.id ?? '',
    kind: 'host',
    name: partial.name,
    protocol: partial.protocol,
    host: partial.host,
    port: partial.port ?? defaultPort(partial.protocol),
    username: partial.username ?? '',
    credentialId: partial.credentialId ?? null,
    tags: partial.tags ?? [],
    notes: partial.notes ?? '',
    ssh: { ...DEFAULT_SSH, ...(partial.ssh ?? {}) },
    rdp: { ...DEFAULT_RDP, ...(partial.rdp ?? {}) },
    vnc: { ...DEFAULT_VNC, ...(partial.vnc ?? {}) },
    lastConnectedAt: partial.lastConnectedAt ?? null
  };
}

export function createGroup(partial: Partial<Group> & { name: string }): Group {
  return {
    id: partial.id ?? '',
    kind: 'group',
    name: partial.name,
    collapsed: partial.collapsed ?? false,
    children: partial.children ?? []
  };
}
