/**
 * RdpEngineHub — единая точка жизненного цикла RDP-сессий (риск R6 из
 * docs/rdp-engine-risk-report.md §4.1).
 *
 * Три адаптера оборачивают существующие движки без изменения их внутренностей:
 *  - iron   → startIronGateway/stopIronGateway (мост RDCleanPath; клиент — WASM
 *             в renderer, поэтому main только поднимает/роняет мост);
 *  - rdpjs  → RdpjsClientManager (canvas-движок: состояния + инъекция ввода);
 *  - legacy → RdpManager (COM-host: оконные команды, состояния — выход процесса
 *             rdp-com-host.exe).
 *
 * Хаб ведёт карту sessionId → engineId:
 *  - события состояния движков атрибутируются своей сессии и уходят в единый
 *    канал `rdp:engine-state` (payload RdpEngineStatePayload);
 *  - closeSession() закрывает РОВНО движок-владелец — раньше sessionClose
 *    дёргал disconnect всех трёх движков подряд на каждую сессию;
 *  - ввод/оконные команды маршрутизируются по capability-флагам движка.
 *
 * Секреты (пароли) разрешаются ДО hub.connect — в хендлерах ipc.ts, у которых
 * есть доступ к хранилищу. Хаб и адаптеры секреты не хранят.
 */
import type { CredentialSet, Host } from '../../shared/types';
import type { RdpLegacyExitedPayload, RdpLegacyRect } from '../../shared/ipc-contract';
import type {
  RdpEngineCapabilities,
  RdpEngineConnectRequest,
  RdpEngineId,
  RdpEnginePhase,
  RdpEngineStartResult,
  RdpEngineStatePayload
} from '../../shared/rdp-engine';
import { startIronGateway, stopIronGateway, stopAllIronGateways } from './iron-sessions';

// ---------------- Контракты адаптеров ----------------

/** Минимальный структурный интерфейс RdpjsClientManager (для тестов — заглушки). */
export interface RdpjsEngineLike {
  connect(
    sessionId: string,
    opts: {
      host: string;
      port?: number;
      username: string;
      password: string;
      domain?: string;
      width?: number;
      height?: number;
    }
  ): Promise<{ ok: boolean; error?: string }>;
  disconnect(sessionId: string): void;
  sendMouse(sessionId: string, x: number, y: number, button: number, isPressed: boolean): void;
  sendWheel(sessionId: string, x: number, y: number, step: number, isNegative: boolean, isHorizontal: boolean): void;
  sendKeyScancode(sessionId: string, code: number, isPressed: boolean): void;
  sendKeyUnicode(sessionId: string, code: number, isPressed: boolean): void;
  closeAll(): void;
}

/** Минимальный структурный интерфейс RdpManager (для тестов — заглушки). */
export interface LegacyEngineLike {
  launch(host: Host, credential: CredentialSet | null, sessionId: string): Promise<{ ok: boolean; error?: string }>;
  stop(sessionId: string): void;
  setRect(sessionId: string, rect: RdpLegacyRect): void;
  activate(sessionId: string): void;
  hide(sessionId: string): void;
  setOverlay(overlay: boolean): void;
  closeAll(): void;
}

/** Инъекция iron-моста (в тестах подменяется фейками). */
export interface IronGatewayDeps {
  start(opts: {
    sessionId: string;
    host: string;
    port?: number;
    onState?: (sessionId: string, state: { phase: 'connecting' | 'connected' | 'error' | 'closed'; message?: string }) => void;
  }): Promise<{ wsUrl: string; authToken: string }>;
  stop(sessionId: string): Promise<void>;
  stopAll(): Promise<void>;
}

const realIronDeps: IronGatewayDeps = {
  start: (opts) => startIronGateway({ ...opts, port: opts.port ?? 3389 }),
  stop: (sessionId) => stopIronGateway(sessionId),
  stopAll: () => stopAllIronGateways()
};

/** Адаптер движка: нормализованный жизненный цикл + capability-флаги. */
export interface RdpEngine {
  readonly id: RdpEngineId;
  readonly capabilities: RdpEngineCapabilities;
  connect(req: RdpEngineConnectRequest): Promise<RdpEngineStartResult>;
  disconnect(sessionId: string): void;
  closeAll(): void | Promise<void>;
}

/** Событие движка до нормализации в RdpEngineStatePayload. */
export interface RdpEngineEvent {
  phase: RdpEnginePhase;
  message?: string;
  exitCode?: number | null;
}

// ---------------- Адаптеры ----------------

/**
 * iron: клиент исполняется в renderer (WASM), main только поднимает мост.
 * Состояния connecting/connected НЕ транслируются в renderer — фазами вкладки
 * управляет сам IronRdpView (мост «connected» наступает раньше реального
 * логина WASM-клиента; раньше эти состояния и не покидали main). Транслируются
 * только error/closed — их view не видит изнутри WASM.
 */
export class IronEngineAdapter implements RdpEngine {
  readonly id: RdpEngineId = 'iron';
  readonly capabilities: RdpEngineCapabilities = {
    rendererClient: true,
    windowEmbedding: false,
    inputInjection: false
  };

  constructor(
    private readonly deps: IronGatewayDeps = realIronDeps,
    private readonly emit: (sessionId: string, event: RdpEngineEvent) => void = () => undefined
  ) {}

  async connect(req: RdpEngineConnectRequest): Promise<RdpEngineStartResult> {
    try {
      const endpoint = await this.deps.start({
        sessionId: req.sessionId,
        host: req.host,
        port: req.port ?? 3389,
        onState: (sessionId, state) => {
          if (state.phase === 'error') {
            this.emit(sessionId, { phase: 'error', message: state.message });
          } else if (state.phase === 'closed') {
            this.emit(sessionId, { phase: 'disconnected', message: state.message });
          }
        }
      });
      return {
        ok: true,
        bridge: {
          wsUrl: endpoint.wsUrl,
          authToken: endpoint.authToken,
          destination: `${req.host}:${req.port ?? 3389}`,
          username: req.username ?? '',
          password: req.password ?? '',
          domain: req.domain
        }
      };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message ?? 'Не удалось поднять RDCleanPath-мост' };
    }
  }

  disconnect(sessionId: string): void {
    void this.deps.stop(sessionId).catch(() => undefined);
  }

  closeAll(): void | Promise<void> {
    return this.deps.stopAll();
  }
}

/** rdpjs: canvas-движок в main-процессе — состояния и инъекция ввода. */
export class RdpjsEngineAdapter implements RdpEngine {
  readonly id: RdpEngineId = 'rdpjs';
  readonly capabilities: RdpEngineCapabilities = {
    rendererClient: false,
    windowEmbedding: false,
    inputInjection: true
  };

  constructor(
    private readonly engine: RdpjsEngineLike,
    private readonly emit: (sessionId: string, event: RdpEngineEvent) => void = () => undefined
  ) {}

  async connect(req: RdpEngineConnectRequest): Promise<RdpEngineStartResult> {
    return await this.engine.connect(req.sessionId, {
      host: req.host,
      port: req.port,
      username: req.username ?? '',
      password: req.password ?? '',
      domain: req.domain,
      width: req.width,
      height: req.height
    });
  }

  disconnect(sessionId: string): void {
    this.engine.disconnect(sessionId);
  }

  closeAll(): void {
    this.engine.closeAll();
  }
}

/** legacy: COM-host с встроенным HWND — оконные команды, состояния через exit процесса. */
export class LegacyEngineAdapter implements RdpEngine {
  readonly id: RdpEngineId = 'legacy';
  readonly capabilities: RdpEngineCapabilities = {
    rendererClient: false,
    windowEmbedding: true,
    inputInjection: false
  };

  constructor(private readonly engine: LegacyEngineLike) {}

  async connect(req: RdpEngineConnectRequest): Promise<RdpEngineStartResult> {
    if (!req.hostProfile) {
      return { ok: false, error: 'legacy: требуется полный профиль хоста' };
    }
    return await this.engine.launch(req.hostProfile, req.credential ?? null, req.sessionId);
  }

  disconnect(sessionId: string): void {
    this.engine.stop(sessionId);
  }

  closeAll(): void {
    this.engine.closeAll();
  }
}

// ---------------- Хаб ----------------

export interface RdpEngineHubDeps {
  rdpjs: RdpjsEngineLike;
  legacy: LegacyEngineLike;
  iron?: IronGatewayDeps;
  /** Единый поток состояний: main транслирует его в канал rdp:engine-state. */
  onState: (payload: RdpEngineStatePayload) => void;
}

export class RdpEngineHub {
  private readonly adapters: Map<RdpEngineId, RdpEngine>;
  /** sessionId → движок-владелец (заполняется при успешном connect). */
  private readonly owners = new Map<string, RdpEngineId>();

  constructor(private readonly deps: RdpEngineHubDeps) {
    const emit = (engine: RdpEngineId) => (sessionId: string, event: RdpEngineEvent) =>
      this.handleEngineEvent(engine, sessionId, event);
    this.adapters = new Map<RdpEngineId, RdpEngine>([
      ['iron', new IronEngineAdapter(deps.iron ?? realIronDeps, emit('iron'))],
      ['rdpjs', new RdpjsEngineAdapter(deps.rdpjs, emit('rdpjs'))],
      ['legacy', new LegacyEngineAdapter(deps.legacy)]
    ]);
  }

  /** Запуск сессии на конкретном движке. Успех фиксирует владельца сессии. */
  async connect(req: RdpEngineConnectRequest): Promise<RdpEngineStartResult> {
    const adapter = this.adapters.get(req.engine);
    if (!adapter) return { ok: false, error: `Неизвестный RDP-движок: ${req.engine}` };
    const res = await adapter.connect(req);
    if (res.ok) this.owners.set(req.sessionId, req.engine);
    return res;
  }

  /** Закрывает сессию у движка-владельца (и только у него). */
  disconnect(sessionId: string): void {
    const engine = this.owners.get(sessionId);
    if (!engine) return;
    this.adapters.get(engine)?.disconnect(sessionId);
    this.owners.delete(sessionId);
  }

  engineOf(sessionId: string): RdpEngineId | null {
    return this.owners.get(sessionId) ?? null;
  }

  // ---- приём событий движков ----

  /**
   * Единая точка входа событий движков. События disconnected/error снимают
   * атрибуцию сессии — повторный closeTab для мёртвой сессии станет no-op.
   */
  handleEngineEvent(engine: RdpEngineId, sessionId: string, event: RdpEngineEvent): void {
    if (event.phase === 'disconnected' || event.phase === 'error') {
      if (this.owners.get(sessionId) === engine) this.owners.delete(sessionId);
    }
    this.deps.onState({
      sessionId,
      engine,
      phase: event.phase,
      message: event.message,
      exitCode: event.exitCode
    });
  }

  /**
   * Выход процесса rdp-com-host.exe — единственный источник состояний legacy.
   * Перевод: есть error → 'error'; штатный выход → 'disconnected' с кодом.
   */
  handleLegacyProcessExit(payload: RdpLegacyExitedPayload): void {
    if (payload.error) {
      this.handleEngineEvent('legacy', payload.sessionId, { phase: 'error', message: payload.error });
    } else {
      this.handleEngineEvent('legacy', payload.sessionId, {
        phase: 'disconnected',
        message: 'RDP-сессия завершена',
        exitCode: payload.code
      });
    }
  }

  // ---- ввод (capability: inputInjection → rdpjs) ----

  sendMouse(sessionId: string, x: number, y: number, button: number, isPressed: boolean): void {
    if (this.owners.get(sessionId) === 'rdpjs') this.deps.rdpjs.sendMouse(sessionId, x, y, button, isPressed);
  }

  sendMouseMove(sessionId: string, x: number, y: number): void {
    if (this.owners.get(sessionId) === 'rdpjs') this.deps.rdpjs.sendMouse(sessionId, x, y, 0, false);
  }

  sendWheel(sessionId: string, x: number, y: number, step: number, isNegative: boolean, isHorizontal: boolean): void {
    if (this.owners.get(sessionId) === 'rdpjs') this.deps.rdpjs.sendWheel(sessionId, x, y, step, isNegative, isHorizontal);
  }

  sendKeyUnicode(sessionId: string, code: number, isPressed: boolean): void {
    if (this.owners.get(sessionId) === 'rdpjs') this.deps.rdpjs.sendKeyUnicode(sessionId, code, isPressed);
  }

  sendKeyScancode(sessionId: string, code: number, isPressed: boolean): void {
    if (this.owners.get(sessionId) === 'rdpjs') this.deps.rdpjs.sendKeyScancode(sessionId, code, isPressed);
  }

  // ---- окна (capability: windowEmbedding → legacy) ----

  setRect(sessionId: string, rect: RdpLegacyRect): void {
    if (this.owners.get(sessionId) === 'legacy') this.deps.legacy.setRect(sessionId, rect);
  }

  activate(sessionId: string): void {
    if (this.owners.get(sessionId) === 'legacy') this.deps.legacy.activate(sessionId);
  }

  hide(sessionId: string): void {
    if (this.owners.get(sessionId) === 'legacy') this.deps.legacy.hide(sessionId);
  }

  /** Оверлей — глобальная команда: применяется, если есть хоть одна legacy-сессия. */
  setOverlay(overlay: boolean): void {
    for (const engine of this.owners.values()) {
      if (engine === 'legacy') {
        this.deps.legacy.setOverlay(overlay);
        return;
      }
    }
  }

  /** before-quit: закрывает все движки. */
  async closeAll(): Promise<void> {
    this.owners.clear();
    for (const adapter of this.adapters.values()) {
      await adapter.closeAll();
    }
  }
}
