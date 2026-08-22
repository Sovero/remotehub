import type { ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import type { CredentialSet, Host } from '../../shared/types';
import type { Sealer } from '../store/crypto-format';
import { resolveAuth } from '../sessions/config';
import { createEmbedEngine, type EmbedRect, type RdpEmbedEngine } from './embed';
import { rdpOptionsFromHost, type RdpFileOptions } from './generator';
import { launchRdp, spawnRdp, type RdpSpawn } from './launcher';

const WINDOW_FIND_TIMEOUT = 15000;
const WATCHDOG_INTERVAL = 2000;
/** После WM_CLOSE даём mstsc столько на вежливый выход, затем TerminateProcess. */
const KILL_GRACE_MS = 3000;

export type RdpMode = 'embedded' | 'window';

export interface RdpLaunchOutcome {
  ok: boolean;
  mode?: RdpMode;
  error?: string;
}

interface ActiveRdp {
  child: ChildProcess | null;
  hwnd: number | null;
  rect: EmbedRect | null;
  /** Вкладка сессии — текущая активная (встроенное окно видно). */
  visible: boolean;
  mode: RdpMode;
  closing: boolean;
  killTimer: NodeJS.Timeout | null;
  searching: boolean;
}

export interface RdpManagerDeps {
  sealer: Sealer;
  send: (channel: 'rdp:exited', payload: unknown) => void;
  /** HWND окна Electron, в которое встраиваем mstsc. */
  getParentHwnd: () => number | null;
  engine?: RdpEmbedEngine;
  /** Внедряемые зависимости для тестов: реальные используются по умолчанию. */
  spawn?: (opts: RdpFileOptions, password: string | null) => Promise<RdpSpawn>;
  legacyLaunch?: typeof launchRdp;
  /** Период сторожа в мс (тесты ставят меньше). */
  watchdogInterval?: number;
  /**
   * Авто-подтверждать предупреждение безопасности mstsc (непроверенный
   * сертификат). По умолчанию true — диалог гасится кликом «Подключить».
   * false — предупреждение показывается пользователю.
   */
  autoAcceptCert?: boolean;
}

/**
 * Управляет RDP-сессиями. Оконные профили встраиваются в окно приложения
 * (дочернее HWND mstsc поверх панели вкладки); fullscreen/multiMonitor —
 * фолбэк в отдельное окно mstsc.
 */
export class RdpManager {
  private readonly active = new Map<string, ActiveRdp>();
  private readonly engine: RdpEmbedEngine;
  private readonly spawnImpl: (opts: RdpFileOptions, password: string | null) => Promise<RdpSpawn>;
  private readonly legacyLaunch: typeof launchRdp;
  private readonly watchdog: NodeJS.Timeout;
  /** Модальный диалог/онбординг открыт — встроенные окна временно скрыты. */
  private overlayHidden = false;
  /** Авто-подтверждение предупреждения безопасности (настройка пользователя). */
  private autoAcceptCert: boolean;

  constructor(private readonly deps: RdpManagerDeps) {
    this.engine = deps.engine ?? createEmbedEngine();
    this.spawnImpl = deps.spawn ?? spawnRdp;
    this.legacyLaunch = deps.legacyLaunch ?? launchRdp;
    this.autoAcceptCert = deps.autoAcceptCert ?? true;
    this.watchdog = setInterval(() => this.tick(), deps.watchdogInterval ?? WATCHDOG_INTERVAL);
    this.watchdog.unref?.();
  }

  /** Настройка «авто-подтверждать сертификат RDP» (из IPC при сохранении настроек). */
  setAutoAcceptCert(value: boolean): void {
    this.autoAcceptCert = value;
  }

  launch(
    host: Host,
    credential: CredentialSet | null,
    sessionId: string
  ): Promise<RdpLaunchOutcome> | RdpLaunchOutcome {
    const opts = rdpOptionsFromHost(host);
    const embeddable = !opts.multiMonitor && opts.screenMode !== 'fullscreen';

    // Пароль для cmdkey: только сохранённый, и только если не запрошен ввод.
    let password: string | null = null;
    if (!opts.promptForCreds) {
      const auth = resolveAuth(credential, undefined, this.deps.sealer, (p) => readFileSync(p, 'utf8'));
      password = auth.password ?? null;
    }

    if (process.env.RH_FAKE_RDP === '1') {
      // Smoke-режим: не запускаем настоящий mstsc, имитируем короткую сессию.
      this.active.set(sessionId, this.fresh({ mode: 'embedded', visible: true }));
      setTimeout(() => {
        this.active.delete(sessionId);
        this.deps.send('rdp:exited', { sessionId, code: 0 });
      }, 1500);
      return { ok: true, mode: 'embedded' };
    }

    if (!embeddable) {
      const result = this.legacyLaunch(opts, password, (outcome) => {
        this.active.delete(sessionId);
        this.deps.send('rdp:exited', { sessionId, code: outcome.code, error: outcome.error });
      });
      if (!result.ok) {
        this.deps.send('rdp:exited', { sessionId, code: null, error: result.error });
        return { ok: false, error: result.error };
      }
      this.active.set(sessionId, this.fresh({ mode: 'window', visible: true }));
      return { ok: true, mode: 'window' };
    }

    return this.launchEmbedded(opts, password, sessionId);
  }

  private async launchEmbedded(
    opts: RdpFileOptions,
    password: string | null,
    sessionId: string
  ): Promise<RdpLaunchOutcome> {
    const spawned = await this.spawnImpl(opts, password);
    if (!spawned.ok || !spawned.child) {
      spawned.cleanup();
      this.deps.send('rdp:exited', {
        sessionId,
        code: null,
        error: spawned.error ?? 'Не удалось запустить mstsc'
      });
      return { ok: false, error: spawned.error ?? 'Не удалось запустить mstsc' };
    }

    const active = this.fresh({ mode: 'embedded', visible: true });
    active.child = spawned.child;
    this.active.set(sessionId, active);

    spawned.child.on('error', (err) => {
      spawned.cleanup();
      const stillTracked = this.active.get(sessionId) === active;
      if (stillTracked) this.active.delete(sessionId);
      if (!active.closing && stillTracked) {
        this.deps.send('rdp:exited', {
          sessionId,
          code: null,
          error: `Не удалось запустить mstsc: ${err.message}`
        });
      }
    });
    spawned.child.on('exit', (code) => {
      spawned.cleanup();
      if (active.killTimer) {
        clearTimeout(active.killTimer);
        active.killTimer = null;
      }
      // Сессия могла быть снята раньше (stop / ошибка прикрепления) — тогда исход уже сообщён.
      const stillTracked = this.active.get(sessionId) === active;
      if (stillTracked) this.active.delete(sessionId);
      if (!active.closing && stillTracked) {
        this.deps.send('rdp:exited', { sessionId, code });
      }
    });

    void this.attachWindow(sessionId, active);
    return { ok: true, mode: 'embedded' };
  }

  /** Находит окно mstsc по PID и встраивает в окно приложения. */
  private async attachWindow(sessionId: string, active: ActiveRdp): Promise<void> {
    if (active.searching || active.closing) return;
    if (active.child?.pid == null) return;
    active.searching = true;
    try {
      // Предупреждение о недоверенном сертификате гасим как можно раньше,
      // если настройка «авто-подтверждать» включена; иначе показываем его.
      if (this.autoAcceptCert) {
        this.engine.confirmSecurityWarning(active.child.pid);
      }
      const hwnd = await this.engine.findWindowByPid(active.child.pid, WINDOW_FIND_TIMEOUT);
      if (this.active.get(sessionId) !== active || active.closing) return;
      if (hwnd === null) {
        // Окно так и не появилось — mstsc не смог стартовать: убиваем и сообщаем.
        this.active.delete(sessionId);
        this.killChild(active);
        if (!active.closing) {
          this.deps.send('rdp:exited', {
            sessionId,
            code: null,
            error: 'Не удалось найти окно Remote Desktop'
          });
        }
        return;
      }
      active.hwnd = hwnd;
      const parentHwnd = this.deps.getParentHwnd();
      if (parentHwnd == null) return; // окно приложения ещё не готово — дождёмся тика
      this.engine.embed(hwnd, parentHwnd);
      this.applyRect(active);
      if (active.visible && !this.overlayHidden) this.engine.show(hwnd);
    } finally {
      active.searching = false;
    }
  }

  /**
   * Сторож: перевстраивает окно, если mstsc его пересоздал (переход
   * «подключение → сессия»), и периодически фиксирует геометрию — mstsc сам
   * ресайзит окно под разрешение удалённого рабочего стола.
   */
  private tick(): void {
    for (const [sessionId, active] of this.active) {
      if (active.mode !== 'embedded' || active.closing) continue;
      // Гасим предупреждение безопасности mstsc (непроверенный сертификат):
      // оно может всплыть и после встраивания окна. Только при включённой
      // настройке — иначе пользователь сам решает в диалоге.
      if (this.autoAcceptCert && active.child?.pid != null) {
        this.engine.confirmSecurityWarning(active.child.pid);
      }
      if (active.hwnd !== null) {
        if (!this.engine.isWindow(active.hwnd)) {
          active.hwnd = null; // окно пересоздано — найдём заново
        } else {
          if (active.visible && !this.overlayHidden && active.rect) {
            this.engine.setRect(active.hwnd, active.rect);
          }
          continue;
        }
      }
      if (active.child && !active.closing) void this.attachWindow(sessionId, active);
    }
  }

  /** Прямоугольник панели вкладки (физические пиксели) — из IPC. */
  setRect(sessionId: string, rect: EmbedRect): void {
    const active = this.active.get(sessionId);
    if (!active || active.mode !== 'embedded') return;
    active.rect = rect;
    this.applyRect(active);
  }

  /** Переключение вкладок: показать окно активной сессии, спрятать остальные. */
  activate(sessionId: string): void {
    for (const [id, active] of this.active) {
      if (active.mode !== 'embedded') continue;
      active.visible = id === sessionId;
      if (active.hwnd === null) continue;
      if (id === sessionId && !this.overlayHidden) {
        this.applyRect(active);
        this.engine.show(active.hwnd);
        this.engine.setForeground(active.hwnd);
      } else {
        this.engine.hide(active.hwnd);
      }
    }
  }

  /** Открытие/закрытие модального диалога: временно прячем встроенные окна. */
  setOverlay(overlay: boolean): void {
    this.overlayHidden = overlay;
    for (const active of this.active.values()) {
      if (active.mode !== 'embedded' || active.hwnd === null) continue;
      if (overlay) {
        this.engine.hide(active.hwnd);
      } else if (active.visible) {
        this.applyRect(active);
        this.engine.show(active.hwnd);
      }
    }
  }

  /** Закрытие вкладки: WM_CLOSE + гарантированный TerminateProcess через KILL_GRACE_MS. */
  stop(sessionId: string): void {
    const active = this.active.get(sessionId);
    if (!active) return;
    active.closing = true;
    this.active.delete(sessionId);
    if (active.mode === 'embedded' && active.hwnd !== null) {
      this.engine.close(active.hwnd);
      this.engine.hide(active.hwnd);
    }
    if (active.child) {
      active.killTimer = setTimeout(() => this.killChild(active), KILL_GRACE_MS);
      active.killTimer.unref?.();
    }
  }

  /** Выход из приложения: закрываем всё. На выходе не ждём — TerminateProcess сразу. */
  closeAll(): void {
    for (const active of this.active.values()) {
      active.closing = true;
      this.killChild(active);
    }
    this.active.clear();
    clearInterval(this.watchdog);
  }

  /** Для смоука: встроилось ли окно сессии. */
  isEmbedded(sessionId: string): boolean {
    const active = this.active.get(sessionId);
    return active !== undefined && active.mode === 'embedded' && active.hwnd !== null;
  }

  private applyRect(active: ActiveRdp): void {
    if (active.hwnd === null || active.rect === null) return;
    this.engine.setRect(active.hwnd, active.rect);
    if (active.visible && !this.overlayHidden) this.engine.show(active.hwnd);
  }

  private killChild(active: ActiveRdp): void {
    if (active.killTimer) {
      clearTimeout(active.killTimer);
      active.killTimer = null;
    }
    try {
      active.child?.kill();
    } catch {
      // процесс уже завершился
    }
  }

  private fresh(over: Pick<ActiveRdp, 'mode' | 'visible'>): ActiveRdp {
    return { child: null, hwnd: null, rect: null, closing: false, killTimer: null, searching: false, ...over };
  }
}