import type { ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import type { CredentialSet, Host } from '../../shared/types';
import type { Sealer } from '../store/crypto-format';
import { resolveAuth } from '../sessions/config';
import { createEmbedEngine, type EmbedRect, type RdpEmbedEngine } from './embed';
import { rdpOptionsFromHost, type RdpFileOptions } from './generator';
import { spawnRdp, type RdpSpawn } from './launcher';

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
      for (const [sessionId, active] of this.active) {
        if (!active.closing) this.syncCertificateWarning(sessionId, active);
      }
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

    const active = this.fresh({ visible: true });
    this.active.set(sessionId, active);
    this.trackChild(sessionId, active, spawned);

    void this.attachWindow(sessionId, active);
    return { ok: true };
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

  /** Находит окно mstsc по PID и встраивает в окно приложения. */
  private async attachWindow(sessionId: string, active: ActiveRdp): Promise<void> {
    if (active.searching || active.closing) return;
    if (active.child?.pid == null) return;
    active.searching = true;
    try {
      // Системное предупреждение нельзя оставлять top-level окном: при ручном
      // режиме оно скрывается, а его решение отображается во вкладке.
      this.syncCertificateWarning(sessionId, active);
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
      active.embedded = false;
      // Скрываем найденный top-level HWND до SetParent. Если окно приложения
      // ещё не готово, mstsc остаётся невидимым и не появляется снаружи.
      this.engine.hide(hwnd);
      // Главный HWND может стать доступен чуть позже (например, при раннем
      // восстановлении вкладок). В этом случае тик повторит именно SetParent,
      // а не оставит окно mstsc самостоятельным top-level окном.
      this.embedWindow(sessionId, active);
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
      if (active.closing) continue;
      // Предупреждение может появиться после создания embedded HWND —
      // обрабатываем его на каждом тике, пока пользователь не принял решение.
      this.syncCertificateWarning(sessionId, active);
      // Панель подключения mstsc (BBar) всплывает после установления сессии —
      // гасим её на каждом тике, чтобы она не висела поверх встроенного окна.
      if (active.child?.pid != null) this.engine.hideAuxiliaryWindows(active.child.pid);
      if (active.hwnd !== null) {
        if (!this.engine.isWindow(active.hwnd)) {
          active.hwnd = null; // окно пересоздано — найдём заново
          active.embedded = false;
        } else if (!active.embedded) {
          // Пока HWND не прикреплён, не считаем сессию встроенной и не
          // оставляем native-клиент снаружи окна приложения.
          this.embedWindow(sessionId, active);
          continue;
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

  /** Принять сертификат из встроенного предупреждения. */
  acceptCertificate(sessionId: string): void {
    const active = this.active.get(sessionId);
    if (!active || active.closing || active.child?.pid == null) return;
    this.engine.confirmSecurityWarning(active.child.pid);
    active.certificatePending = false;
    active.certificateAccepted = true;
    this.deps.send('rdp:certificate', { sessionId, pending: false });
  }

  /** Отклонить сертификат и закрыть RDP-сессию внутри текущей вкладки. */
  rejectCertificate(sessionId: string): void {
    const active = this.active.get(sessionId);
    if (!active || active.closing) return;
    if (active.child?.pid != null) this.engine.rejectSecurityWarning(active.child.pid);
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

  /**
   * Держит системное предупреждение внутри UX вкладки: при авто-режиме
   * нажимает «Подключить», при ручном — прячет native dialog и сообщает UI.
   */
  private syncCertificateWarning(sessionId: string, active: ActiveRdp): void {
    const pid = active.child?.pid;
    if (pid == null || active.closing) return;
    const warning = this.engine.findSecurityWarning(pid);
    if (this.autoAcceptCert) {
      // Движок сам ищет warning; вызов без найденного окна безопасен и
      // сохраняет повторную проверку для появившегося позднее диалога.
      this.engine.confirmSecurityWarning(pid);
      active.certificateAccepted = false;
      if (active.certificatePending) {
        active.certificatePending = false;
        this.deps.send('rdp:certificate', { sessionId, pending: false });
      }
      return;
    }
    if (active.certificateAccepted) {
      // BM_CLICK может закрывать диалог асинхронно. Держим его скрытым до
      // исчезновения, но не возвращаем предупреждение в UI повторно.
      if (warning === null) active.certificateAccepted = false;
      else this.engine.hide(warning);
      return;
    }
    if (active.certificatePending) {
      if (warning !== null) this.engine.hide(warning);
      return;
    }
    if (warning === null) return;
    this.engine.hide(warning);
    active.certificatePending = true;
    this.deps.send('rdp:certificate', { sessionId, pending: true });
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