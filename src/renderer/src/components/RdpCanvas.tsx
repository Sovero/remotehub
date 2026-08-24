/**
 * RdpCanvas — рендеринг RDP-сессии на HTML5 Canvas.
 *
 * Получает битмапы от node-rdpjs через IPC и отрисовывает их.
 * Захватывает мышь/клавиатуру/колёсико и отправляет в main-процесс.
 */
import React, { useCallback, useEffect, useRef } from 'react';

interface BitmapUpdate {
  destLeft: number;
  destTop: number;
  width: number;
  height: number;
  data: Uint8Array;
}

interface RdpjsBitmapPayload {
  sessionId: string;
  destLeft: number;
  destTop: number;
  width: number;
  height: number;
  data: ArrayBuffer;
}

interface Props {
  sessionId: string;
  width: number;
  height: number;
  connected: boolean;
}

const RdpCanvas: React.FC<Props> = ({ sessionId, width, height, connected }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Инициализация канваса
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    canvas.tabIndex = 0;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctxRef.current = ctx;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    }
  }, [width, height]);

  useEffect(() => {
    initCanvas();
  }, [initCanvas]);

  // Приём битмапов
  useEffect(() => {
    if (!connected) return;

    const handler = (payload: RdpjsBitmapPayload): void => {
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (!canvas || !ctx || payload.sessionId !== sessionId) return;

      const raw = new Uint8ClampedArray(payload.data);
      const imgData = new ImageData(raw, payload.width, payload.height);

      // BGRA → RGBA swap
      const pixels = imgData.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const b = pixels[i];
        pixels[i] = pixels[i + 2];
        pixels[i + 2] = b;
      }

      ctx.putImageData(imgData, payload.destLeft, payload.destTop);
    };

    window.api.onRdpjsBitmap?.(handler);
    return () => {
      window.api.offRdpjsBitmap?.(handler as (...args: unknown[]) => void);
    };
  }, [connected, sessionId]);

  // Очистка при дисконнекте
  useEffect(() => {
    if (!connected) {
      const ctx = ctxRef.current;
      const canvas = canvasRef.current;
      if (ctx && canvas) {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [connected]);

  // Мышь
  const mouseXY = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY)
      };
    },
    [width, height]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!connected) return;
      const { x, y } = mouseXY(e);
      window.api.rdpjsMouse?.(sessionId, x, y, e.button === 0 ? 1 : e.button === 2 ? 2 : e.button, true);
    },
    [connected, sessionId, mouseXY]
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!connected) return;
      const { x, y } = mouseXY(e);
      window.api.rdpjsMouse?.(sessionId, x, y, e.button === 0 ? 1 : e.button === 2 ? 2 : e.button, false);
    },
    [connected, sessionId, mouseXY]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!connected) return;
      const { x, y } = mouseXY(e);
      window.api.rdpjsMouseMove?.(sessionId, x, y);
    },
    [connected, sessionId, mouseXY]
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!connected) return;
      e.preventDefault();
      const { x, y } = mouseXY(e as unknown as React.MouseEvent<HTMLCanvasElement>);
      const step = Math.min(Math.abs(e.deltaY), 120);
      window.api.rdpjsWheel?.(sessionId, x, y, step, e.deltaY > 0, false);
    },
    [connected, sessionId, mouseXY]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (!connected) return;
      e.preventDefault();
      if (e.key.length === 1) {
        window.api.rdpjsKeyUnicode?.(sessionId, e.key.charCodeAt(0), true);
      }
    },
    [connected, sessionId]
  );

  const onKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (!connected) return;
      e.preventDefault();
      if (e.key.length === 1) {
        window.api.rdpjsKeyUnicode?.(sessionId, e.key.charCodeAt(0), false);
      }
    },
    [connected, sessionId]
  );

  // Автофокус
  useEffect(() => {
    if (connected && canvasRef.current) {
      canvasRef.current.focus();
    }
  }, [connected]);

  return (
    <canvas
      ref={canvasRef}
      className="rdp-canvas"
      style={{
        width: '100%',
        height: '100%',
        cursor: connected ? 'none' : 'default',
        outline: 'none',
        display: 'block',
        background: '#000'
      }}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseMove={onMouseMove}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
};

export default React.memo(RdpCanvas);