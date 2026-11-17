import { useEffect, useMemo, useRef } from 'react';
import RFB from '@novnc/novnc';
import { createClipboardSync } from '../lib/clipboard';
import { offerRemoteClipboard } from '../lib/remote-clipboard';
import { useApp, type SessionTab } from '../store';
import Icon from './Icon';

export default function VncViewer({ tab }: { tab: SessionTab }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const connectedRef = useRef(false);
  const applySessionState = useApp((s) => s.applySessionState);
  const vnc = tab.vnc;
  // Общий с RDP механизм буфера: защита от эха и опрос локального буфера.
  // noVNC сам игнорирует clipboardPasteFrom вне состояния connected и не пишет
  // в закрытый сокет, поэтому здесь только источник текста: isReady нужен лишь
  // чтобы не читать буфер обмена после разрыва.
  const clip = useMemo(
    () =>
      createClipboardSync({
        push: (text) => rfbRef.current?.clipboardPasteFrom(text),
        isReady: () => connectedRef.current
      }),
    []
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!vnc || !container) return;

    // noVNC 1.7 сам начинает подключение в конструкторе — публичного
    // метода connect() у RFB нет, вызывать его не нужно (и нельзя).
    const rfb = new RFB(container, `ws://127.0.0.1:${vnc.port}`, {
      credentials: vnc.password ? { password: vnc.password } : undefined
    });
    rfbRef.current = rfb;
    rfb.viewOnly = false;

    // Масштаб и качество из профиля
    const host = tab.adHocHost;
    const scale = host?.vnc.scale ?? 'scale';
    const quality = host?.vnc.quality ?? 6;
    rfb.scaleViewport = scale === 'scale';
    rfb.resizeSession = scale === 'local';
    rfb.qualityLevel = quality;

    rfb.addEventListener('connect', () => {
      connectedRef.current = true;
      rfb.focus();
      // Сервер должен получить наш буфер заранее — иначе первая вставка в
      // удалённом приложении увидит пустой буфер.
      void clip.pushCurrent(true);
    });
    rfb.addEventListener('disconnect', (e) => {
      connectedRef.current = false;
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
    // Буфер обмена VNC → локальный: noVNC отдаёт текст события clipboard.
    rfb.addEventListener('clipboard', (e) => {
      const text = (e as CustomEvent<{ text: string }>).detail.text;
      if (!text) return;
      // Запоминаем для защиты от эха, а писать ли в буфер — решает политика.
      clip.markRemote(text);
      offerRemoteClipboard(text, `VNC · ${tab.title}`);
    });
    rfb.addEventListener('credentialsrequired', () => {
      applySessionState(tab.sessionId, {
        phase: 'error',
        message: 'VNC-сервер требует учётные данные, которых нет в профиле'
      });
    });

    // Страховка: если рукопожатие RFB так и не завершилось (сервер молчит
    // или завис после версии), не держим вкладку в «Подключение…» вечно.
    // Точную причину чаще успевает назвать мост (vnc:error) — тогда
    // состояние уже error, и этот таймер её не перезапишет.
    const handshakeTimer = setTimeout(() => {
      const tabNow = useApp
        .getState()
        .tabs.find((t) => t.sessionId === tab.sessionId);
      if (tabNow?.state.phase === 'connecting') {
        applySessionState(tab.sessionId, {
          phase: 'error',
          message:
            'VNC-сервер не завершил рукопожатие. Проверьте адрес и порт (по умолчанию 5900), а также настройки шифрования на сервере.'
        });
      }
    }, 15000);

    return () => {
      clearTimeout(handshakeTimer);
      connectedRef.current = false;
      rfbRef.current = null;
      try {
        rfb.disconnect();
      } catch {
        // уже отключён
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.sessionId, tab.vnc?.port, clip]);

  // Отслеживание локального буфера: скопированное в Windows должно доехать до
  // VNC к моменту вставки.
  useEffect(() => clip.start(), [clip]);

  const fullscreen = (): void => {
    containerRef.current?.requestFullscreen().catch(() => undefined);
  };

  return (
    <div className="vnc-wrap">
      <div className="vnc-toolbar">
        <span className="vnc-hint">VNC · {tab.title}</span>
        <button className="btn btn--sm" onClick={fullscreen}>
          <Icon name="expand" size={13} /> Полный экран
        </button>
      </div>
      <div className="vnc-canvas" ref={containerRef} />
    </div>
  );
}
