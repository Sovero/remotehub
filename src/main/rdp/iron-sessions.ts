/**
 * Реестр IronGateway по sessionId: один мост = одна RDP-сессия.
 * Разделён с ipc.ts, чтобы before-quit мог остановить всё разом.
 */
import { addLog } from '../log';
import { IronGateway, type IronGatewayOptions } from './iron-gateway';

const gateways = new Map<string, IronGateway>();

/** Запускает (или перезапускает) мост для сессии и возвращает его порт на 127.0.0.1. */
export async function startIronGateway(opts: IronGatewayOptions): Promise<number> {
  const prev = gateways.get(opts.sessionId);
  if (prev) {
    gateways.delete(opts.sessionId);
    await prev.stop().catch(() => undefined);
  }
  const gw = new IronGateway({
    ...opts,
    onState: (sessionId, state) => {
      // Состояния моста попадают в журнал: connecting/connected/error/closed + причина.
      addLog(
        state.phase === 'error' ? 'error' : state.phase === 'closed' ? 'warn' : 'info',
        'iron',
        `IronRDP: сессия ${sessionId} — ${state.phase}${state.message ? ` (${state.message})` : ''}`
      );
      opts.onState?.(sessionId, state);
    }
  });
  const port = await gw.start();
  gateways.set(opts.sessionId, gw);
  return port;
}

/** Останавливает мост сессии, если он был. */
export async function stopIronGateway(sessionId: string): Promise<void> {
  const gw = gateways.get(sessionId);
  if (!gw) return;
  gateways.delete(sessionId);
  await gw.stop().catch(() => undefined);
}

/** Останавливает все мосты (before-quit). */
export async function stopAllIronGateways(): Promise<void> {
  const ids = [...gateways.keys()];
  await Promise.all(ids.map((id) => stopIronGateway(id)));
}
