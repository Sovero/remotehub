import { readFileSync } from 'fs';
import { createServer, type Server, type Socket } from 'net';
import { nanoid } from 'nanoid';
import { Client } from 'ssh2';
import type { TunnelInfo } from '../../shared/ipc-contract';
import type { CredentialSet, Host } from '../../shared/types';
import { buildSshConfig, resolveAuth } from '../sessions/config';
import type { Sealer } from '../store/crypto-format';

interface Tunnel {
  id: string;
  localPort: number;
  targetHost: string;
  targetPort: number;
  active: boolean;
  error?: string;
}

interface SessionTunnels {
  client: Client;
  tunnels: Map<string, Tunnel>;
  servers: Map<string, Server>;
}

function toInfo(t: Tunnel): TunnelInfo {
  return {
    id: t.id,
    localPort: t.localPort,
    targetHost: t.targetHost,
    targetPort: t.targetPort,
    active: t.active,
    error: t.error
  };
}

/**
 * Локальный порт → целевой хост:порт через SSH-соединение сеанса.
 * Одно SSH-соединение на сеанс обслуживает все его туннели; соединение
 * и туннели закрываются вместе с сеансом (stopAll при закрытии вкладки).
 */
export class TunnelManager {
  private readonly sessions = new Map<string, SessionTunnels>();

  constructor(private readonly sealer: Sealer) {}

  async add(
    sessionId: string,
    host: Host,
    credential: CredentialSet | null,
    localPort: number,
    targetHost: string,
    targetPort: number
  ): Promise<{ ok: boolean; tunnel?: TunnelInfo; error?: string }> {
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
      return { ok: false, error: 'Некорректный локальный порт' };
    }
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      return { ok: false, error: 'Некорректный целевой порт' };
    }
    if (!targetHost.trim()) {
      return { ok: false, error: 'Укажите целевой хост' };
    }
    try {
      let st = this.sessions.get(sessionId);
      if (!st) {
        st = await this.connect(sessionId, host, credential);
      }
      for (const t of st.tunnels.values()) {
        if (t.localPort === localPort) {
          return { ok: false, error: `Порт ${localPort} уже занят туннелем этого сеанса` };
        }
      }
      const tunnel: Tunnel = {
        id: nanoid(8),
        localPort,
        targetHost: targetHost.trim(),
        targetPort,
        active: false
      };
      const server = await this.listen(st, tunnel);
      st.tunnels.set(tunnel.id, tunnel);
      st.servers.set(tunnel.id, server);
      return { ok: true, tunnel: toInfo(tunnel) };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      return {
        ok: false,
        error: e.code === 'EADDRINUSE' ? `Порт ${localPort} уже занят` : e.message
      };
    }
  }

  list(sessionId: string): TunnelInfo[] {
    const st = this.sessions.get(sessionId);
    if (!st) return [];
    return [...st.tunnels.values()].map(toInfo);
  }

  stop(sessionId: string, tunnelId: string): void {
    const st = this.sessions.get(sessionId);
    if (!st) return;
    this.stopTunnel(st, tunnelId);
  }

  /** Закрывает все туннели сеанса и его SSH-соединение. */
  stopAll(sessionId: string): void {
    const st = this.sessions.get(sessionId);
    if (!st) return;
    for (const id of [...st.tunnels.keys()]) this.stopTunnel(st, id);
    try {
      st.client.end();
    } catch {
      // уже закрыто
    }
    this.sessions.delete(sessionId);
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.stopAll(id);
  }

  private connect(sessionId: string, host: Host, credential: CredentialSet | null): Promise<SessionTunnels> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const auth = resolveAuth(credential, undefined, this.sealer, (p) => readFileSync(p, 'utf8'));
      const config = buildSshConfig(host, auth);
      client.once('ready', () => {
        const st: SessionTunnels = { client, tunnels: new Map(), servers: new Map() };
        this.sessions.set(sessionId, st);
        resolve(st);
      });
      client.once('error', (err) => reject(err));
      client.on('close', () => {
        const st = this.sessions.get(sessionId);
        if (st && st.client === client) {
          for (const srv of st.servers.values()) {
            try {
              srv.close();
            } catch {
              // уже закрыт
            }
          }
          st.servers.clear();
          for (const t of st.tunnels.values()) {
            t.active = false;
            t.error = 'SSH-соединение закрыто';
          }
        }
      });
      client.connect(config);
    });
  }

  private listen(st: SessionTunnels, tunnel: Tunnel): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.handleConnection(st, tunnel, socket));
      server.on('error', (err) => {
        tunnel.active = false;
        tunnel.error = (err as NodeJS.ErrnoException).code === 'EADDRINUSE' ? 'Порт занят' : err.message;
      });
      server.once('error', reject);
      server.listen(tunnel.localPort, '127.0.0.1', () => {
        server.removeListener('error', reject);
        tunnel.active = true;
        tunnel.error = undefined;
        resolve(server);
      });
    });
  }

  private handleConnection(st: SessionTunnels, tunnel: Tunnel, socket: Socket): void {
    st.client.forwardOut('127.0.0.1', tunnel.localPort, tunnel.targetHost, tunnel.targetPort, (err, stream) => {
      if (err || !stream) {
        socket.destroy();
        return;
      }
      socket.on('error', () => stream.destroy());
      stream.on('error', () => socket.destroy());
      const teardown = (): void => {
        stream.destroy();
        socket.destroy();
      };
      socket.on('close', teardown);
      stream.on('close', teardown);
      socket.pipe(stream);
      stream.pipe(socket);
    });
  }

  private stopTunnel(st: SessionTunnels, tunnelId: string): void {
    const server = st.servers.get(tunnelId);
    if (server) {
      try {
        server.close();
      } catch {
        // уже закрыт
      }
      st.servers.delete(tunnelId);
    }
    st.tunnels.delete(tunnelId);
  }
}
