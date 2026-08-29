import type { ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import type { CredentialSet, Host } from '../../shared/types';
import type { Sealer } from '../store/crypto-format';
import { resolveAuth } from '../sessions/config';
import { createEmbedEngine, type EmbedRect, type RdpEmbedEngine } from './embed';
import { rdpOptionsFromHost } from './generator';
import { spawnComRdp, type RdpComSpawn } from './com-launcher';

const WATCHDOG_INTERVAL = 2000;
/** После WM_CLOSE даём RDP-хосту столько на вежливый выход, затем TerminateProcess. */
const KILL_GRACE_MS = 3000;
/** Debounce для resize-команды в COM-хост: не чаще чем раз в N мс. */
const RESIZE_DEBOUNCE_MS = 300;

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
  /** Debounce-таймер для resize-команды в COM-хост (stdin "resize W H"). */
  resizeTimer: NodeJS.Timeout | null;
  /** Последний отправленный в COM-хост размер (чтобы не слать дубли). */
  lastResizeW: number;
  lastResizeH: number;
}

export interface RdpManagerDeps {
  sealer: Sealer;
  send: (channel: 'rdp-legacy:exited', payload: unknown) => void;
  /** HWND окна Electron, в которое встраиваем COM-хост. BigInt — 64-битный указатель. */
  getParentHwnd: () => bigint | null;
  /**
   * Экранные координаты левого верхнего угла content area родителя — нужны,
   * чтобы превратить rect вкладки (относительный, из рендерера) в абсолютные
   * координаты для owned-окна (см. embed.ts).
   */
  getParentOrigin: () => { x: number; y: number } | null;
  engine?: RdpEmbedEngine;
  /** Внедряемые зависимости для тестов: реальные используются по умолчанию. */
  comSpawn?: (opts: ReturnType<typeof rdpOptionsFromHost>, password: string | null) => Promise<RdpComSpawn>;
  /** Период сторожа в мс (тесты ставят меньше). */
  watchdogInterval?: number;
  /** Задержка аварийного завершения после WM_CLOSE (тесты сокращают). */
  killGraceMs?: number;
}

/**
 * Legacy-движок RDP: MsRdpClient ActiveX (тот же mstscax.dll, что и у mstsc.exe
 * и Devolutions RDM на Windows) встраивается child HWND в главное окно Electron.
 *
 * Существует как ручной запасной вариант рядом с IronRDP: у некоторых RDP-серверов
 * сертификат несовместим с rustls (нет digitalSignature в Key Usage — сервер может
 * предложить только классический RSA-обмен ключей, который rustls принципиально не
 * реализует ни в одной версии TLS). SChannel такие сертификаты терпит ради обратной
 * совместимости, поэтому этот движок подключается там, где IronRDP не может.
 */
export class RdpManager {
  private readonly active = new Map<string, ActiveRdp>();
  private readonly engine: RdpEmbedEngine;
  private readonly comSpawnImpl: (
    opts: ReturnType<typeof rdpOptionsFromHost>,
    password: string | null
  ) => Promise<RdpComSpawn>;
  private readonly watchdog: NodeJS.Timeout;
  private readonly killGraceMs: number;
  /** Модальный диалог/онбординг открыт — встроенные окна временно скрыты. */
  private overlayHidden = false;
  /**
   * Главное окно свёрнуто — owned-окна и так прячутся системой вместе с
   * владельцем, но explicit-флаг не даёт им показаться при restore, если
   * в этот момент активен overlay или скрытая вкладка.
   */
  private minimized = false;

  private get canShow(): boolean {
    return !this.overlayHidden && !this.minimized;
  }

  constructor(private readonly deps: RdpManagerDeps) {
    this.engine = deps.engine ?? createEmbedEngine();
    this.comSpawnImpl = deps.comSpawn ?? spawnComRdp;
    this.killGraceMs = deps.killGraceMs ?? KILL_GRACE_MS;
    this.watchdog = setInterval(() => this.tick(), deps.watchdogInterval ?? WATCHDOG_INTERVAL);
    this.watchdog.unref?.();
  }

  async launch(host: Host, credential: CredentialSet | null, sessionId: string): Promise<RdpLaunchOutcome> {
    const opts = rdpOptionsFromHost(host);
    // Имя пользователя/домен профиля host.username почти всегда пусты, когда
    // подключение идёт через сохранённый набор учётных данных (credentialId) —
    // тогда username живёт на CredentialSet, а не на Host (см. ipc.ts:ironStart,
    // тот же приём). Конвенция mstsc: DOMAIN\user → server_domain + username.
    let username = credential?.username || opts.username;
    let domain = opts.domain;
    const slash = username.indexOf('\\');
    if (slash > 0) {
      domain = username.slice(0, slash);
      username = username.slice(slash + 1);
    }
    let password: string | null = null;
    if (!opts.promptForCreds) {
      const auth = resolveAuth(credential, undefined, this.deps.sealer, (p) => readFileSync(p, 'utf8'));
      password = auth.password ?? null;
    }

    // Заглушка регистрируется ДО ожидания спавна: рендерер шлёт первый rect
    // почти сразу при монтировании панели (см. LegacyRdpView), а сам COM-хост
    // стартует не мгновенно (spawn + cmdkey + ожидание HWND из stdout) — без
    // заглушки ранний rdpLegacyRect находит пустую карту и теряется навсегда
    // (ResizeObserver больше не сработает, если размер панели не изменится).
    const active: ActiveRdp = {
      child: null,
      hwnd: null,
      rect: null,
      embedded: false,
      visible: true,
      closing: false,
      killTimer: null,
      resizeTimer: null,
      lastResizeW: 0,
      lastResizeH: 0
    };
    this.active.set(sessionId, active);

    const comSpawn = await this.comSpawnImpl({ ...opts, username, domain }, password);

    // Сессию могли остановить (stop()), пока мы ждали спавн — тогда заглушку
    // уже убрали из карты, и продолжать встраивание некуда.
    if (this.active.get(sessionId) !== active || active.closing) {
      comSpawn.cleanup();
      return { ok: false, error: 'Сессия отменена до завершения запуска' };
    }

    if (!comSpawn.ok || !comSpawn.child || comSpawn.hwnd === undefined) {
      comSpawn.cleanup();
      this.active.delete(sessionId);
      const error = comSpawn.error ?? 'Не удалось запустить RDP COM-хост';
      this.deps.send('rdp-legacy:exited', { sessionId, code: null, error });
      return { ok: false, error };
    }

    active.child = comSpawn.child;
    active.hwnd = comSpawn.hwnd;

    this.trackChild(sessionId, active, comSpawn);
    this.embedWindow(sessionId, active);
    return { ok: true };
  }

  /** Обработчики процесса rdp-com-host.exe: снятие сессии из карты и уведомление рендерера. */
  private trackChild(sessionId: string, active: ActiveRdp, spawned: RdpComSpawn): void {
    spawned.child?.on('error', (err) => {
      spawned.cleanup();
      const stillTracked = this.active.get(sessionId) === active;
      if (stillTracked) this.active.delete(sessionId);
      if (!active.closing && stillTracked) {
        this.deps.send('rdp-legacy:exited', { sessionId, code: null, error: `RDP COM-хост ошибка: ${err.message}` });
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
        this.deps.send('rdp-legacy:exited', { sessionId, code });
      }
    });
  }

  /** Сторож: перевстраивает окно, если родительский HWND ещё не готов при запуске. */
  private tick(): void {
    for (const [sessionId, active] of this.active) {
      if (active.closing || active.hwnd === null) continue;
      if (!active.embedded) this.embedWindow(sessionId, active);
    }
  }

  /** Прямоугольник панели вкладки (физические пиксели) — из IPC. */
  setRect(sessionId: string, rect: EmbedRect): void {
    const active = this.active.get(sessionId);
    if (!active) return;
    active.rect = rect;
    // До embedWindow() окно остаётся скрытым; координаты и show применяем
    // только после подтверждённого привязывания к окну Electron (owner).
    if (active.embedded) this.applyRect(active);
  }

  /** Привязывает найденный HWND к главному окну Electron (owner). */
  private embedWindow(sessionId: string, active: ActiveRdp): boolean {
    if (active.hwnd === null || active.embedded) return active.embedded;
    const parentHwnd = this.deps.getParentHwnd();
    if (parentHwnd == null) return false;
    try {
      this.engine.hide(active.hwnd);
      this.engine.embed(active.hwnd, parentHwnd);
      active.embedded = true;
      this.applyRect(active);
      if (active.visible && this.canShow) this.engine.show(active.hwnd);
      return true;
    } catch (err) {
      active.closing = true;
      this.active.delete(sessionId);
      this.killChild(active);
      this.deps.send('rdp-legacy:exited', {
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
      if (id === sessionId && this.canShow) {
        this.applyRect(active);
        this.engine.show(active.hwnd);
        this.engine.setForeground(active.hwnd);
        // Клавиатура должна попадать в COM-хост сразу после переключения вкладки:
        // без явного SetFocus её перехватывает Chromium.
        this.engine.focus(active.hwnd);
      } else {
        this.engine.hide(active.hwnd);
      }
    }
  }

  /**
   * Прячет окно конкретной сессии, не трогая видимость остальных — вызывается,
   * когда активная вкладка переключилась на что-то, что не является RDP-сессией
   * этого движка (терминал, VNC, другая RDP-вкладка на iron и т.п.).
   */
  hide(sessionId: string): void {
    const active = this.active.get(sessionId);
    if (!active) return;
    active.visible = false;
    if (active.hwnd !== null) this.engine.hide(active.hwnd);
  }

  /** Открытие/закрытие модального диалога: временно прячем встроенные окна. */
  setOverlay(overlay: boolean): void {
    this.overlayHidden = overlay;
    for (const active of this.active.values()) {
      if (active.hwnd === null || !active.embedded) continue;
      if (overlay) {
        this.engine.hide(active.hwnd);
      } else if (active.visible && this.canShow) {
        this.applyRect(active);
        this.engine.show(active.hwnd);
      }
    }
  }

  /**
   * Главное окно свернули/восстановили. Owned-окна Windows и так прячет/
   * показывает вместе с владельцем, но explicit-скрытие на время минимизации
   * не даёт им остаться видимыми поверх чужих окон, а на восстановлении не
   * даёт показаться скрытой вкладке или окну поверх открытого диалога.
   */
  setMinimized(minimized: boolean): void {
    this.minimized = minimized;
    for (const active of this.active.values()) {
      if (active.hwnd === null || !active.embedded) continue;
      if (minimized) {
        this.engine.hide(active.hwnd);
      } else if (active.visible && this.canShow) {
        this.applyRect(active);
        this.engine.show(active.hwnd);
      }
    }
  }

  /**
   * Главное окно подвинули/изменили размер: экранное положение content area
   * поменялось, но относительный rect вкладки — нет. Пересчитываем позицию
   * всех встроенных окон от нового origin.
   */
  refreshLayout(): void {
    for (const active of this.active.values()) {
      if (active.embedded) this.applyRect(active);
    }
  }

  /** Закрытие вкладки: WM_CLOSE + гарантированный TerminateProcess через KILL_GRACE_MS. */
  stop(sessionId: string): void {
    const active = this.active.get(sessionId);
    if (!active) return;
    active.closing = true;
    if (active.resizeTimer) {
      clearTimeout(active.resizeTimer);
      active.resizeTimer = null;
    }
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
  }

  /** Для смоука: встроилось ли окно сессии. */
  isEmbedded(sessionId: string): boolean {
    const active = this.active.get(sessionId);
    return active !== undefined && active.hwnd !== null && active.embedded;
  }

  private applyRect(active: ActiveRdp): void {
    if (!active.embedded || active.hwnd === null || active.rect === null) return;
    const origin = this.deps.getParentOrigin();
    if (origin === null) return;
    this.engine.setRect(active.hwnd, {
      x: origin.x + active.rect.x,
      y: origin.y + active.rect.y,
      width: active.rect.width,
      height: active.rect.height
    });
    if (active.visible && this.canShow) this.engine.show(active.hwnd);
    // COM-хост: с debounce отправляем «resize W H» в stdin, чтобы RDP-контроль
    // адаптировал разрешение удалённого рабочего стола под новый размер.
    this.scheduleComResize(active);
  }

  /**
   * Debounce-отправка «resize W H» в stdin COM-хоста. При частом изменении
   * размера вкладки (drag, maximize) команда уходит не чаще чем раз в
   * RESIZE_DEBOUNCE_MS, и только если размер реально изменился.
   */
  private scheduleComResize(active: ActiveRdp): void {
    if (!active.rect || active.closing || !active.child) return;
    const w = Math.max(100, Math.round(active.rect.width));
    const h = Math.max(100, Math.round(active.rect.height));
    if (w === active.lastResizeW && h === active.lastResizeH) return;
    if (active.resizeTimer) clearTimeout(active.resizeTimer);
    active.resizeTimer = setTimeout(() => {
      active.resizeTimer = null;
      if (active.closing || !active.child) return;
      try {
        active.child.stdin?.write(`resize ${w} ${h}\n`);
        active.lastResizeW = w;
        active.lastResizeH = h;
      } catch {
        // stdin уже закрыт — процесс завершается
      }
    }, RESIZE_DEBOUNCE_MS);
    active.resizeTimer.unref?.();
  }

  private killChild(active: ActiveRdp): void {
    if (active.killTimer) {
      clearTimeout(active.killTimer);
      active.killTimer = null;
    }
    if (active.resizeTimer) {
      clearTimeout(active.resizeTimer);
      active.resizeTimer = null;
    }
    try {
      active.child?.stdin?.write('quit\n');
    } catch {
      /* stdin уже закрыт */
    }
    try {
      active.child?.kill();
    } catch {
      // процесс уже завершился
    }
  }
}
