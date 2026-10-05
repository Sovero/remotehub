/**
 * LegacyRdpView — запасной RDP-движок: MsRdpClient ActiveX (mstscax.dll),
 * тот же движок, что у mstsc.exe и Devolutions RDM на Windows, встроенный
 * child HWND поверх этой панели.
 *
 * В отличие от IronRdpView (canvas в DOM, TLS/CredSSP ведёт rustls в WASM),
 * здесь реальный RDP-рендеринг делает нативный процесс main (rdp-com-host.exe),
 * а эта панель — лишь прозрачная область-плейсхолдер, чьи экранные координаты
 * непрерывно передаются в main, который держит нативное окно поверх неё
 * (Win32 SetParent/SetWindowPos). Нужен для серверов, чей TLS-сертификат
 * несовместим с rustls (см. src/main/rdp/iron-gateway.ts) — SChannel такие
 * сертификаты терпит ради обратной совместимости.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Host } from '@shared/types';
import { useApp } from '../store';

const RECT_DEBOUNCE_MS = 150;

interface Props {
  sessionId: string;
  host: Host;
  active: boolean;
}

const LegacyRdpView: React.FC<Props> = ({ sessionId, host, active }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState(0);

  /**
   * Отправляет текущий прямоугольник панели (CSS px) в main — там он
   * превращается в команду setrect для встроенного окна. Скрытая вкладка
   * (display: none) даёт 0×0, и такой rect отправлять нельзя: он затирал бы
   * последний корректный, и при возврате на вкладку окно мигало бы размером
   * 1×1 (ср. guard 320×240 в IronRdpView).
   */
  const reportRect = useCallback((): void => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    window.api.rdpLegacyRect(sessionId, { x: r.left, y: r.top, width: r.width, height: r.height });
  }, [sessionId]);

  // Переподключение из тулбара.
  useEffect(() => {
    const name = `legacy-reconnect-${sessionId}`;
    const handler = (): void => setAttempt((a) => a + 1);
    window.addEventListener(name, handler);
    return () => window.removeEventListener(name, handler);
  }, [sessionId]);

  // Жизненный цикл сессии: запуск при монтировании/переподключении, остановка при размонтировании.
  useEffect(() => {
    let disposed = false;
    void window.api.rdpLegacyLaunch({ sessionId, host }).then((res) => {
      if (disposed) return;
      if (res.ok) {
        useApp.getState().applySessionState(sessionId, { phase: 'connected' });
        // Страховка к первому rect при монтировании: к моменту ответа на
        // launch хаб уже знает сессию, поэтому команда гарантированно доедет
        // до RdpManager и окно встанет в рамку без ресайза главного окна.
        reportRect();
      } else {
        useApp.getState().applySessionState(sessionId, {
          phase: 'error',
          message: res.error ?? 'Не удалось запустить системный RDP-движок'
        });
      }
    });
    return () => {
      disposed = true;
      window.api.rdpLegacyStop(sessionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, attempt, reportRect]);

  // Показ/скрытие встроенного окна при переключении вкладок.
  useEffect(() => {
    if (active) window.api.rdpLegacyActivate(sessionId);
    else window.api.rdpLegacyHide(sessionId);
  }, [active, sessionId]);

  // Прямоугольник панели (CSS px) → main, с дебаунсом на частые ресайзы.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timer: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reportRect, RECT_DEBOUNCE_MS);
    });
    ro.observe(el);
    reportRect();
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
    // attempt: при переподключении хост-процесс перезапускается с чистым
    // ActiveRdp.rect = null, а сам элемент панели мог не измениться — без
    // переотправки текущего rect здесь окно осталось бы в старой позиции.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, attempt, reportRect]);

  return <div className="legacy-rdp-view" ref={wrapRef} />;
};

export default LegacyRdpView;
