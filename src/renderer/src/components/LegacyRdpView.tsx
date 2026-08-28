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
import { useEffect, useRef, useState } from 'react';
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
  }, [sessionId, attempt]);

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
    const report = (): void => {
      const r = el.getBoundingClientRect();
      window.api.rdpLegacyRect(sessionId, { x: r.left, y: r.top, width: r.width, height: r.height });
    };
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(report, RECT_DEBOUNCE_MS);
    });
    ro.observe(el);
    report();
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [sessionId]);

  return <div className="legacy-rdp-view" ref={wrapRef} />;
};

export default LegacyRdpView;
