/**
 * Единый контракт RDP-движков (риск R6 из docs/rdp-engine-risk-report.md).
 *
 * Три движка проекта — iron (IronRDP/WASM), rdpjs (Legacy canvas) и legacy
 * (COM-host/MsTscAx) — сходятся здесь на одном интерфейсе жизненного цикла:
 *
 *   renderer (существующие вызовы)
 *     └─ ipc.ts: тонкие хендлеры → RdpEngineHub.connect/disconnect/input
 *          └─ адаптеры движков (iron-sessions / RdpjsClientManager / RdpManager)
 *
 * Секреты (пароли) разрешаются ДО вызова hub.connect — в хендлерах ipc.ts,
 * у которых есть доступ к хранилищу. Хаб и адаптеры секреты не хранят.
 */
import type { CredentialSet, Host } from './types';
import type { RdpLegacyRect } from './ipc-contract';

export type RdpEngineId = 'iron' | 'rdpjs' | 'legacy';

/**
 * Единые фазы состояния. Каждый движок переводит свои нативные события в эти
 * фазы (см. адаптеры в src/main/rdp/engine-hub.ts):
 *  - iron:    connecting/connected шлёт сам view (WASM-клиент), мост эмитит
 *             только 'error' (например, сторож тишины TLS);
 *  - rdpjs:   'connecting'|'connected'|'disconnected' из RdpjsClientManager;
 *  - legacy:  выход процесса rdp-com-host.exe → 'error' (с сообщением) либо
 *             'disconnected' (штатное завершение, exitCode приложен).
 */
export type RdpEnginePhase = 'connecting' | 'connected' | 'disconnected' | 'error';

/** Единый payload состояния RDP-сессии (канал rdp:engine-state). */
export interface RdpEngineStatePayload {
  sessionId: string;
  engine: RdpEngineId;
  phase: RdpEnginePhase;
  /** Причина закрытия или текст ошибки. */
  message?: string;
  /** Код выхода процесса для движков с отдельным процессом (legacy). */
  exitCode?: number | null;
}

/**
 * Нормализованный запрос запуска. Единая форма для всех трёх движков:
 *  - iron/rdpjs используют скалярные host/port; legacy требует полный профиль
 *    (hostProfile) — из него берутся rdp-опции и параметры встроенного окна;
 *  - username/password уже разрешены из хранилища (или введены в диалоге);
 *    движки, которые сами читают Credential Manager (legacy), пароль получают
 *    внутри адаптера через RdpManager.launch.
 */
export interface RdpEngineConnectRequest {
  sessionId: string;
  engine: RdpEngineId;
  host: string;
  port?: number;
  /** Полный профиль хоста — обязателен для legacy, остальным не мешает. */
  hostProfile?: Host;
  username?: string;
  /** Пароль открытым текстом — только что разрешённый из хранилища/диалога. */
  password?: string;
  credentialId?: string | null;
  /** Уже разрешённый набор учётных данных — обязателен для legacy (RdpManager.launch). */
  credential?: CredentialSet | null;
  domain?: string;
  width?: number;
  height?: number;
}

/** Результат запуска сессии. */
export interface RdpEngineStartResult {
  ok: boolean;
  error?: string;
  /**
   * Только iron: адрес локального RDCleanPath-моста для WASM-клиента.
   * Секрет сессии (authToken) в логи не писать.
   */
  bridge?: {
    wsUrl: string;
    authToken: string;
    destination: string;
    username: string;
    password: string;
    domain?: string;
  };
}

/** Что умеет движок — хаб по этим флагам маршрутизирует ввод и оконные команды. */
export interface RdpEngineCapabilities {
  /** Фактический клиент исполняется в renderer (iron WASM): main только поднимает мост. */
  rendererClient: boolean;
  /** Оконные команды встроенного HWND: setRect/activate/hide/setOverlay (legacy). */
  windowEmbedding: boolean;
  /** Инъекция мыши/клавиатуры из main (rdpjs). */
  inputInjection: boolean;
}
