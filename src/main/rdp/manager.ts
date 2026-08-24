import type { ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import type { CredentialSet, Host } from '../../shared/types';
import type { Sealer } from '../store/crypto-format';
import { resolveAuth } from '../sessions/config';
import { createEmbedEngine, type EmbedRect, type RdpEmbedEngine } from './embed';
import { rdpOptionsFromHost, type RdpFileOptions } from './generator';
import { spawnRdp, type RdpSpawn } from './launcher';
import { spawnComRdp, type RdpComSpawn } from './com-launcher';

const WINDOW_FIND_TIMEOUT = 15000;
const WATCHDOG_INTERVAL = 2000;
/** Предупреждение mstsc может появиться сразу после основного HWND. */
const CERTIFICATE_POLL_INTERVAL = 100;
/** После WM_CLOSE даём mstsc столько на вежливый выход, затем TerminateProcess. */
const KILL_GRACE_MS = 3000;

/** Результат RDP не содержит внешнего/window-режима: сессия всегда embedded. */
export interface RdpLaunchOutcome {
  ok: boolean;
  error?: string;
}

interface ActiveRdp {
  child: ChildProcess | null;
  hwnd: bigint | null;
  rect: EmbedRect | null;
  /** HWND уже прикреплён к родителю Electron; до этого он не считается embedded. */
  embedded: boolean;
  /** Вкладка сессии — текущая активная (встроенное окно видно). */
  visible: boolean;
  closing: boolean;
  killTimer: NodeJS.Timeout | null;
  searching: boolean;
  certificatePending: boolean;
  /** После ручного подтверждения не показываем тот же native-диалог повторно,
   * пока mstsc не уберёт его; это предотвращает мерцание баннера. */
  certificateAccepted: boolean;
}

export interface RdpManagerDeps {
  sealer: Sealer;
  send: (channel: 'rdp:exited' | 'rdp:certificate', payload: unknown) => void;
  /** HWND окна Electron, в которое встраиваем mstsc. BigInt — 64-битный указатель. */
  getParentHwnd: () => bigint | null;
  engine?: RdpEmbedEngine;
  /** Внедряемые зависимости для тестов: реальные используются по умолчанию. */
  spawn?: (opts: RdpFileOptions, password: string | null) => Promise<RdpSpawn>;
  /** Период сторожа в мс (тесты ставят меньше). */
  watchdogInterval?: number;
  /** Задержка аварийного завершения после WM_CLOSE (тесты сокращают). */
  killGraceMs?: number;
  /**
   * Авто-подтверждать предупреждение безопасности mstsc (непроверенный
   * сертификат). По умолчанию true — диалог гасится кликом «Подключить».
   * false — предупреждение показывается пользователю.
   */
  autoAcceptCert?: boolean;
}

/**
 * Управляет RDP-сессиями. mstsc используется только как дочернее HWND,
 * прикреплённое к главному окну Electron поверх сцены активной вкладки.
 * Полноэкранный и мультимониторный профиль адаптируются генератором к одной
 * встроенной сцене, поэтому отдельного top-level RDP-окна не существует.
 */
export class RdpManager {
  private readonly active = new Map<string, ActiveRdp>();
  private readonly engine: RdpEmbedEngine;
  private readonly spawnImpl: (opts: RdpFileOptions, password: string | null) => Promise<RdpSpawn>;
  private readonly watchdog: NodeJS.Timeout;
  private readonly certificateWatchdog: NodeJS.Timeout;
  private readonly killGraceMs: number;
  /** Модальный диалог/онбординг открыт — встроенные окна временно скрыты. */
  private overlayHidden = false;
  /** Авто-подтверждение предупреждения безопасности (настройка пользователя). */
  private autoAcceptCert: boolean;

  constructor(private readonly deps: RdpManagerDeps) {
    this.engine = deps.engine ?? createEmbedEngine();
    this.spawnImpl = deps.spawn ?? spawnRdp;
    this.autoAcceptCert = deps.autoAcceptCert ?? true;
    this.killGraceMs = deps.killGraceMs ?? KILL_GRACE_MS;
    this.watchdog = setInterval(() => this.tick(), deps.watchdogInterval ?? WATCHDOG_INTERVAL);
    this.watchdog.unref?.();
    this.certificateWatchdog = setInterval(() => {
      // COM-хост сам управляет сертификатом и вспомогательными окнами —
      // для mstsc здесь был hideAuxiliaryWindows, но он больше не нужен.
    }, CERTIFICATE_POLL_INTERVAL);
    this.certificateWatchdog.unref?.();
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

    // Пароль для cmdkey: только сохранённый, и только если не запрошен ввод.
    let password: string | null = null;
    if (!opts.promptForCreds) {
      const auth = resolveAuth(credential, undefined, this.deps.sealer, (p) => readFileSync(p, 'utf8'));
      password = auth.password ?? null;
    }

    if (process.env.RH_FAKE_RDP === '1') {
      // Smoke-режим: не запускаем настоящий mstsc, имитируем короткую сессию.
      this.active.set(sessionId, this.fresh({ visible: true }));
      setTimeout(() => {
        this.active.delete(sessionId);
        this.deps.send('rdp:exited', { sessionId, code: 0 });
      }, 1500);
      return { ok: true };
    }

    // Даже fullscreen/multiMonitor идут через один и тот же embedded-путь.
    return this.launchEmbedded(opts, password, sessionId);
  }

  private async launchEmbedded(
    opts: RdpFileOptions,
    password: string | null,
    sessionId: string
  ): Promise<RdpLaunchOutcome> {
    // COM-хост: rdp-com-host.exe загружает MsRdpClient9 ActiveX,
    // выводит HWND в stdout. Ноль mstsc.exe в процессах.
    const comSpawn = await spawnComRdp(opts, password);
    if (!comSpawn.ok || !comSpawn.child || comSpawn.hwnd === undefined) {
      comSpawn.cleanup();
      this.deps.send('rdp:exited', {
        sessionId,
        code: null,
        error: comSpawn.error ?? 'Не удалось запустить RDP COM-хост'
      });
      return { ok: false, error: comSpawn.error ?? 'Не удалось запустить RDP COM-хост' };
    }

    const active = this.fresh({ visible: true });
    this.active.set(sessionId, active);
    active.child = comSpawn.child;
    active.hwnd = comSpawn.hwnd;
    active.embedded = false;

    this.trackComChild(sessionId, active, comSpawn);
    void this.embedWindow(sessionId, active);
    return { ok: true };
  }

  /**
   * Обработчики процесса rdp-com-host.exe: quit-команда при остановке,
   * снятие сессии из карты и уведомление рендерера.
   */
  private trackComChild(sessionId: string, active: ActiveRdp, spawned: RdpComSpawn): void {
    spawned.child?.on('error', (err) => {
      spawned.cleanup();
      const stillTracked = this.active.get(sessionId) === active;
      if (stillTracked) this.active.delete(sessionId);
      if (!active.closing && stillTracked) {
        this.deps.send('rdp:exited', {
          sessionId,
          code: null,
          error: `RDP COM-хост ошибка: ${err.message}`
        });
      }
    });
    spawned.child?.on('exit', (code) => {
      spawned.cleanup();
      if (active.killTimer) {
        clearTimeout(active.killTimer);
        active.killTimer = null;
      }
      const stillTracked = this.active.get(sessionId) === active;
      if (stillTracked) this.active.delete(sessionId);
      if (!active.closing && stillTracked) {
        this.deps.send('rdp:exited', { sessionId, code });
      }
    });
  }

  /**
   * Обработчики процесса mstsc: очистка временных файлов, снятие сессии
   * из карты и уведомление рендерера (если сессия не закрывалась вручную).
   */
  private trackChild(sessionId: string, active: ActiveRdp, spawned: RdpSpawn): void {
    active.child = spawned.child ?? null;
    spawned.child?.on('error', (err) => {
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
    spawned.child?.on('exit', (code) => {
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
  }

  /**
   * Сторож: перевстраивает окно, если родительский HWND ещё не готов,
   * и периодически фиксирует геометрию.
   */
  private tick(): void {
    for (const [sessionId, active] of this.active) {
      if (active.closing) continue;
      if (active.hwnd !== null) {
        if (!active.embedded) {
          // HWND получен от COM-хоста, но ещё не прикреплён к Electron.
          this.embedWindow(sessionId, active);
        } else if (active.visible && !this.overlayHidden && active.rect) {
          this.engine.setRect(active.hwnd, active.rect);
        }
      }
    }
  }

  /** Принять сертификат (COM-хост управляет им сам — заглушка для IPC). */
  acceptCertificate(sessionId: string): void {
    const active = this.active.get(sessionId);
    if (!active || active.closing) return;
    active.certificatePending = false;
    active.certificateAccepted = true;
    this.deps.send('rdp:certificate', { sessionId, pending: false });
  }

  /** Отклонить сертификат и закрыть RDP-сессию внутри текущей вкладки. */
  rejectCertificate(sessionId: string): void {
    const active = this.active.get(sessionId);
    if (!active || active.closing) return;
    active.certificatePending = false;
    active.certificateAccepted = false;
    active.closing = true;
    this.active.delete(sessionId);
    this.killChild(active);
    this.deps.send('rdp:certificate', { sessionId, pending: false });
    this.deps.send('rdp:exited', {
      sessionId,
      code: null,
      error: 'Подключение RDP отменено: сертификат хоста не подтверждён'
    });
  }

  /** Прямоугольник панели вкладки (физические пиксели) — из IPC. */
  setRect(sessionId: string, rect: EmbedRect): void {
    const active = this.active.get(sessionId);
    if (!active) return;
    active.rect = rect;
    // До SetParent окно остаётся скрытым; координаты и show применяем только
    // после подтверждённого встраивания в HWND Electron.
    if (active.embedded) this.applyRect(active);
  }

  /**
   * Прикрепляет найденный HWND к главному окну Electron.
   * Возвращает false, если окно приложения ещё не имеет native HWND.
   */
  private embedWindow(sessionId: string, active: ActiveRdp): boolean {
    if (active.hwnd === null || active.embedded) return active.embedded;
    const parentHwnd = this.deps.getParentHwnd();
    if (parentHwnd == null) return false;
    try {
      this.engine.hide(active.hwnd);
      this.engine.embed(active.hwnd, parentHwnd);
      active.embedded = true;
      this.applyRect(active);
      if (active.visible && !this.overlayHidden) this.engine.show(active.hwnd);
      return true;
    } catch (err) {
      active.closing = true;
      this.active.delete(sessionId);
      this.killChild(active);
      this.deps.send('rdp:exited', {
        sessionId,
        code: null,
        error: `Не удалось встроить Remote Desktop во вкладку: ${(err as Error).message}`
      });
      return false;
    }
  }

  /** Переключение вкладок: показать окно активной сессии, спрятать остальные. */
  activate(sessionId: string): void {
    for (const [id, active] of this.active) {
      if (active.closing) continue;
      active.visible = id === sessionId;
      if (active.hwnd === null) continue;
      if (!active.embedded) {
        this.engine.hide(active.hwnd);
        continue;
      }
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
      if (active.hwnd === null) continue;
      if (!active.embedded) {
        this.engine.hide(active.hwnd);
        continue;
      }
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
    if (active.hwnd !== null) {
      this.engine.close(active.hwnd);
      this.engine.hide(active.hwnd);
    }
    if (active.child) {
      active.killTimer = setTimeout(() => this.killChild(active), this.killGraceMs);
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
    clearInterval(this.certificateWatchdog);
  }

  /** Для смоука: встроилось ли окно сессии. */
  isEmbedded(sessionId: string): boolean {
    const active = this.active.get(sessionId);
    return active !== undefined && active.hwnd !== null && active.embedded;
  }

  private applyRect(active: ActiveRdp): void {
    if (!active.embedded || active.hwnd === null || active.rect === null) return;
    this.engine.setRect(active.hwnd, active.rect);
    if (active.visible && !this.overlayHidden) this.engine.show(active.hwnd);
  }

  private killChild(active: ActiveRdp): void {
    if (active.killTimer) {
      clearTimeout(active.killTimer);
      active.killTimer = null;
    }
    // COM-хост: отправляем quit через stdin для вежливого закрытия
    try {
      (active.child as any)?.stdin?.write?.('quit\n');
    } catch { /* stdin уже закрыт */ }
    try {
      active.child?.kill();
    } catch {
      // процесс уже завершился
    }
  }

  private fresh(over: Pick<ActiveRdp, 'visible'>): ActiveRdp {
    return {
      child: null,
      hwnd: null,
      rect: null,
      embedded: false,
      closing: false,
      killTimer: null,
      searching: false,
      certificatePending: false,
      certificateAccepted: false,
      ...over
    };
  }
}