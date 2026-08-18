import { readFileSync } from 'fs';
import type { Host } from '../../shared/types';
import { resolveAuth } from '../sessions/config';
import type { Sealer } from '../store/crypto-format';
import { startBridge, type BridgeHandle } from './bridge';
import type { CredentialSet } from '../../shared/types';

export interface VncOpenResult {
  ok: boolean;
  port?: number;
  password?: string;
  error?: string;
}

export class VncManager {
  private readonly bridges = new Map<string, BridgeHandle>();

  constructor(private readonly sealer: Sealer) {}

  async open(host: Host, credential: CredentialSet | null, sessionId: string): Promise<VncOpenResult> {
    const port = host.port ?? 5900;
    try {
      const bridge = await startBridge(host.host, port);
      this.bridges.set(sessionId, bridge);

      // Пароль VNC нужен клиенту для RFB-рукопожатия (noVNC шифрует
      // challenge клиентски). Отдаём только для активной сессии, в память.
      let password: string | undefined;
      const auth = resolveAuth(credential, undefined, this.sealer, (p) => readFileSync(p, 'utf8'));
      if (auth.password) password = auth.password;

      return { ok: true, port: bridge.port, password };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  close(sessionId: string): void {
    const bridge = this.bridges.get(sessionId);
    if (bridge) {
      bridge.close();
      this.bridges.delete(sessionId);
    }
  }

  closeAll(): void {
    for (const bridge of this.bridges.values()) bridge.close();
    this.bridges.clear();
  }
}
