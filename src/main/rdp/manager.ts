import { readFileSync } from 'fs';
import type { CredentialSet, Host } from '../../shared/types';
import type { Sealer } from '../store/crypto-format';
import { resolveAuth } from '../sessions/config';
import { launchRdp, type RdpOutcome } from './launcher';
import { rdpOptionsFromHost } from './generator';

export class RdpManager {
  private readonly active = new Map<string, { stop: () => void }>();

  constructor(
    private readonly sealer: Sealer,
    private readonly send: (channel: 'rdp:exited', payload: unknown) => void
  ) {}

  launch(
    host: Host,
    credential: CredentialSet | null,
    sessionId: string
  ): { ok: boolean; error?: string } {
    const opts = rdpOptionsFromHost(host);

    // Пароль для cmdkey: только сохранённый, и только если не запрошен ввод.
    let password: string | null = null;
    if (!opts.promptForCreds) {
      const auth = resolveAuth(credential, undefined, this.sealer, (p) => readFileSync(p, 'utf8'));
      password = auth.password ?? null;
    }

    if (process.env.RH_FAKE_RDP === '1') {
      // Smoke-режим: не запускаем настоящий mstsc, имитируем короткую сессию.
      setTimeout(() => this.send('rdp:exited', { sessionId, code: 0 }), 1500);
      return { ok: true };
    }

    const result = launchRdp(opts, password, (outcome: RdpOutcome) => {
      this.active.delete(sessionId);
      this.send('rdp:exited', { sessionId, code: outcome.code, error: outcome.error });
    });
    if (!result.ok) {
      this.send('rdp:exited', { sessionId, code: null, error: result.error });
      return result;
    }
    this.active.set(sessionId, { stop: () => undefined });
    return { ok: true };
  }

  stop(sessionId: string): void {
    // mstsc — отдельный процесс; «остановить» значит просто забыть сессию.
    this.active.delete(sessionId);
  }

  closeAll(): void {
    this.active.clear();
  }
}
