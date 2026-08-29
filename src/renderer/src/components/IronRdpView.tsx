/**
 * IronRdpView — PoC рендеринга RDP через @devolutions/iron-remote-desktop-rdp.
 *
 * Транспорт: renderer открывает WebSocket на локальный RDCleanPath-мост в main
 * (src/main/rdp/iron-gateway.ts), WASM-клиент IronRDP ведёт протокол сам
 * (X.224 → TLS/CredSSP → виртуальные каналы) и рисует прямо в <canvas>.
 * Никаких HWND, SetParent и z-order войны с Chromium — класс проблем
 * нативного встраивания отсутствует в принципе.
 *
 * Секреты: пароль разрешён в main из хранилища (credentialId), сюда приходит
 * уже готовый результат ironStart; WASM-клиент выполняет NLA на своей стороне.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Backend, init } from '@devolutions/iron-remote-desktop-rdp';
import { useApp } from '../store';

let initPromise: Promise<void> | null = null;
/**
 * WASM грузится один раз на процесс (встроен в бандл как base64 data URI).
 * 'debug' — не 'info': стадии X.224/TLS/CredSSP/NLA внутри WASM-клиента
 * видны только на этом уровне, а именно они нужны, чтобы понять, на чём
 * зависает подключение после того, как шлюз уже отчитался "connected".
 * Console-хук в main (src/main/index.ts) переносит это в журнал приложения.
 */
function ensureInit(): Promise<void> {
  initPromise ??= init('debug');
  return initPromise;
}

/** Минимальный структурный тип сессии (библиотека не экспортирует класс напрямую). */
interface IronSession {
  resize(
    width: number,
    height: number,
    scaleFactor?: number | null,
    physicalWidth?: number | null,
    physicalHeight?: number | null
  ): void;
  applyInputs(tx: unknown): void;
  run(): Promise<{ reason(): string }>;
  shutdown(): void;
}

interface Props {
  sessionId: string;
  host: string;
  port: number;
  domain: string;
  credentialId: string | null;
  width: number;
  height: number;
}

const RECONNECT_DEBOUNCE_MS = 250;

const IronRdpView: React.FC<Props> = ({ sessionId, host, port, domain: requestedDomain, credentialId, width, height }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<IronSession | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Переподключение из тулбара: reconnectTab диспатчит событие вместо rdpjsLaunch.
  useEffect(() => {
    const name = `iron-reconnect-${sessionId}`;
    const handler = (): void => setAttempt((a) => a + 1);
    window.addEventListener(name, handler);
    return () => window.removeEventListener(name, handler);
  }, [sessionId]);

  // Жизненный цикл соединения.
  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        await ensureInit();
        const canvas = canvasRef.current;
        if (!canvas || disposed) return;

        const res = await window.api.ironStart({ sessionId, host, port, domain: requestedDomain, credentialId });
        if (disposed) return;
        if (!res.ok || !res.wsUrl) {
          useApp.getState().applySessionState(sessionId, {
            phase: 'error',
            message: res.error ?? 'Не удалось запустить RDCleanPath-мост'
          });
          return;
        }

        // Конвенция mstsc: DOMAIN\user → server_domain + username.
        let username = res.username ?? '';
        let domain = res.domain ?? requestedDomain;
        const slash = username.indexOf('\\');
        if (slash > 0) {
          domain = username.slice(0, slash);
          username = username.slice(slash + 1);
        }

        const sb = new Backend.SessionBuilder();
        sb.proxyAddress(res.wsUrl);
        // WASM-клиент требует auth_token при RDCleanPath-подключении
        // (ironerror "auth_token missing"). Мост токен не проверяет — это
        // просто строка в Request PDU (proxy_auth).
        sb.authToken('remote-hub');
        sb.destination(res.destination ?? `${host}:${port}`);
        sb.username(username);
        sb.password(res.password ?? '');
        if (domain) sb.serverDomain(domain);
        // Обязательные колбэки WASM-клиента: без них connect() падает с
        // "set_cursor_style_callback missing". Курсором в smoke мы не управляем,
        // поэтому колбэк-заглушка.
        sb.setCursorStyleCallback(() => undefined);
        sb.setCursorStyleCallbackContext(null);
        sb.renderCanvas(canvas);
        // Разрешение хоста (width/height) — только запасной вариант на случай,
        // если панель ещё не отрисована. Подключаемся сразу под фактический
        // размер вкладки, чтобы не было видимого шага «подключились мелко,
        // тут же ResizeObserver растянул» — сессия должна сразу выглядеть
        // так, будто она всегда подгонялась под окно.
        const panelRect = wrapRef.current?.getBoundingClientRect();
        const initialWidth = panelRect && panelRect.width >= 320 ? Math.round(panelRect.width) : width;
        const initialHeight = panelRect && panelRect.height >= 240 ? Math.round(panelRect.height) : height;
        sb.desktopSize(new Backend.DesktopSize(initialWidth, initialHeight));

        const session = (await sb.connect()) as unknown as IronSession;
        if (disposed) {
          try {
            session.shutdown();
          } catch {
            /* ignore */
          }
          return;
        }
        sessionRef.current = session;
        useApp.getState().applySessionState(sessionId, { phase: 'connected' });

        session
          .run()
          .then((term) => {
            if (disposed) return;
            const reason = term?.reason?.() ?? '';
            useApp
              .getState()
              .applySessionState(sessionId, {
                phase: 'closed',
                reason: reason ? `RDP-сессия завершена: ${reason}` : 'RDP-сессия завершена'
              });
          })
          .catch((e: unknown) => {
            if (!disposed) {
              useApp
                .getState()
                .applySessionState(sessionId, { phase: 'error', message: String((e as Error)?.message ?? e) });
            }
          });
      } catch (e) {
        if (!disposed) {
          let detail = String((e as Error)?.message ?? e);
          // wasm-bindgen IronError: текст живёт в backtrace() на прототипе.
          try {
            const o = e as Record<string, (() => unknown) | undefined>;
            const backtrace = o.backtrace;
            if (typeof backtrace === 'function') {
              const t = String(backtrace.call(e));
              if (t && t !== 'undefined') detail = t;
            }
          } catch {
            /* keep detail */
          }
          useApp.getState().applySessionState(sessionId, {
            phase: 'error',
            message: detail
          });
        }
      }
    })();

    return () => {
      disposed = true;
      try {
        sessionRef.current?.shutdown();
      } catch {
        /* ignore */
      }
      sessionRef.current = null;
      void window.api.ironStop(sessionId);
    };
  }, [sessionId, attempt, host, port, requestedDomain, credentialId, width, height]);

  // Ввод: мышь / колесо / клавиатура → InputTransaction(DeviceEvent).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const send = (build: (tx: InstanceType<typeof Backend.InputTransaction>) => void): void => {
      const s = sessionRef.current;
      if (!s) return;
      const tx = new Backend.InputTransaction();
      build(tx);
      s.applyInputs(tx);
    };
    const pos = (e: { clientX: number; clientY: number }): [number, number] => {
      const c = canvasRef.current;
      if (!c) return [0, 0];
      const r = c.getBoundingClientRect();
      const sx = c.width / Math.max(1, r.width);
      const sy = c.height / Math.max(1, r.height);
      return [
        Math.min(c.width - 1, Math.max(0, Math.round((e.clientX - r.left) * sx))),
        Math.min(c.height - 1, Math.max(0, Math.round((e.clientY - r.top) * sy)))
      ];
    };

    const onMove = (e: PointerEvent): void => {
      const [x, y] = pos(e);
      send((t) => t.addEvent(Backend.DeviceEvent.mouseMove(x, y)));
    };
    const onDown = (e: PointerEvent): void => {
      el.focus();
      const [x, y] = pos(e);
      send((t) => {
        t.addEvent(Backend.DeviceEvent.mouseMove(x, y));
        t.addEvent(Backend.DeviceEvent.mouseButtonPressed(e.button));
      });
    };
    const onUp = (e: PointerEvent): void => {
      const [x, y] = pos(e);
      send((t) => {
        t.addEvent(Backend.DeviceEvent.mouseMove(x, y));
        t.addEvent(Backend.DeviceEvent.mouseButtonReleased(e.button));
      });
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      // RotationUnit.Pixel = 0 (enum не экспортирован библиотекой).
      if (e.deltaY !== 0) send((t) => t.addEvent(Backend.DeviceEvent.wheelRotations(true, -e.deltaY, 0 as never)));
      if (e.deltaX !== 0) send((t) => t.addEvent(Backend.DeviceEvent.wheelRotations(false, -e.deltaX, 0 as never)));
    };
    const onKey = (e: KeyboardEvent): void => {
      // Модификаторы оставляем хоткеям приложения.
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      let ch: string | null = null;
      if (e.key.length === 1) ch = e.key;
      else if (e.key === 'Enter') ch = '\r';
      else if (e.key === 'Backspace') ch = '\b';
      else if (e.key === 'Escape') ch = '\u001b';
      else if (e.key === 'Tab') ch = '\t';
      if (!ch) return;
      e.preventDefault();
      send((t) => t.addEvent(Backend.DeviceEvent.unicodePressed(ch)));
      send((t) => t.addEvent(Backend.DeviceEvent.unicodeReleased(ch)));
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
    };
  }, []);

  // Динамический resize под размер панели (дебаунс — серверу нужна пауза).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timer: number | undefined;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w < 320 || h < 240) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          sessionRef.current?.resize(w, h);
        } catch {
          /* ignore */
        }
      }, RECONNECT_DEBOUNCE_MS);
    });
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="iron-rdp-view" ref={wrapRef} tabIndex={0}>
      <canvas ref={canvasRef} width={width} height={height} />
    </div>
  );
};

export default React.memo(IronRdpView);
