import { useEffect, useRef } from 'react';
import RFB from '@novnc/novnc';
import { useApp, type SessionTab } from '../store';

export default function VncViewer({ tab }: { tab: SessionTab }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const applySessionState = useApp((s) => s.applySessionState);
  const vnc = tab.vnc;

  useEffect(() => {
    const container = containerRef.current;
    if (!vnc || !container) return;

    const rfb = new RFB(container, `ws://127.0.0.1:${vnc.port}`, {
      credentials: vnc.password ? { password: vnc.password } : undefined
    });
    rfb.viewOnly = false;

    // Масштаб и качество из профиля
    const host = tab.adHocHost;
    const scale = host?.vnc.scale ?? 'scale';
    const quality = host?.vnc.quality ?? 6;
    rfb.scaleViewport = scale === 'scale';
    rfb.resizeSession = scale === 'local';
    rfb.qualityLevel = quality;

    rfb.addEventListener('connect', () => {
      rfb.focus();
    });
    rfb.addEventListener('disconnect', (e) => {
      const detail = (e as CustomEvent<{ clean: boolean; reason: string }>).detail;
      applySessionState(tab.sessionId, {
        phase: 'closed',
        reason: detail?.reason ? `VNC: ${detail.reason}` : 'VNC-соединение закрыто'
      });
    });
    rfb.addEventListener('securityfailure', (e) => {
      const detail = (e as CustomEvent<{ reason: string }>).detail;
      applySessionState(tab.sessionId, {
        phase: 'error',
        message: `Ошибка безопасности VNC: ${detail?.reason ?? 'отказ авторизации'}`
      });
    });
    rfb.addEventListener('credentialsrequired', () => {
      applySessionState(tab.sessionId, {
        phase: 'error',
        message: 'VNC-сервер требует учётные данные, которых нет в профиле'
      });
    });

    try {
      rfb.connect();
    } catch (err) {
      applySessionState(tab.sessionId, { phase: 'error', message: (err as Error).message });
    }

    return () => {
      try {
        rfb.disconnect();
      } catch {
        // уже отключён
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.sessionId, tab.vnc?.port]);

  const fullscreen = (): void => {
    containerRef.current?.requestFullscreen().catch(() => undefined);
  };

  return (
    <div className="vnc-wrap">
      <div className="vnc-toolbar">
        <span className="vnc-hint">VNC · {tab.title}</span>
        <button className="btn btn--sm" onClick={fullscreen}>
          ⛶ Полный экран
        </button>
      </div>
      <div className="vnc-canvas" ref={containerRef} />
    </div>
  );
}
