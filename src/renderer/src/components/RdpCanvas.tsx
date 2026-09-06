/**
 * RdpCanvas — рендеринг RDP-сессии на HTML5 Canvas (движок rdpjs).
 *
 * Получает битмапы от node-rdpjs-2 через IPC и отрисовывает их.
 * Захватывает мышь/клавиатуру/колёсико и отправляет в main-процесс.
 *
 * Производительность:
 *  - распакованные кадры приходят в BGRA (32 бита); разворот B↔R делается
 *    одним проходом по Uint32Array (а не побайтово) — в разы быстрее;
 *  - входящие кадры копируются в очередь сразу (IPC-пейлоад одноразовый),
 *    а блит на Canvas выполняется один раз за кадр (rAF): очередь из N
 *    битмапов за 16 мс сливается в одну отрисовку.
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
  /** Кадры, ожидающие ближайшего rAF-блита. */
  const pendingRef = useRef<BitmapUpdate[]>([]);
  const rafRef = useRef<number>(0);

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

  // Приём битмапов: копия в очередь + rAF-блит один раз за кадр.
  useEffect(() => {
    if (!connected) return;

    /** BGRA → RGBA одним проходом по 32-битным словам. */
    const bgraToRgba = (buf: Uint8ClampedArray): void => {
      const words = new Uint32Array(buf.buffer, buf.byteOffset, buf.length >> 2);
      for (let i = 0; i < words.length; i++) {
        const px = words[i];
        words[i] = (px & 0xff00ff00) | ((px & 0x000000ff) << 16) | ((px & 0x00ff0000) >> 16);
      }
    };

    const flush = (): void => {
      rafRef.current = 0;
      const pending = pendingRef.current;
      pendingRef.current = [];
      const ctx = ctxRef.current;
      if (!ctx || pending.length === 0) return;

      for (const b of pending) {
        const expected = b.width * b.height * 4;
        if (b.data.length < expected) continue;
        // Буфер ровно размера прямоугольника: ImageData требует точную длину.
        const imgBuf = new Uint8ClampedArray(expected);
        imgBuf.set(b.data.subarray(0, expected));
        bgraToRgba(imgBuf);
        const imgData = new ImageData(imgBuf, b.width, b.height);
        try {
          ctx.putImageData(imgData, b.destLeft, b.destTop);
        } catch {
          // putImageData кидает при выходе за пределы канваса (кадры после
          // изменения размера сессии) — такие прямоугольники пропускаем.
        }
      }
    };

    const handler = (payload: RdpjsBitmapPayload): void => {
      if (payload.sessionId !== sessionId) return;
      if (payload.width <= 0 || payload.height <= 0) return;
      // Копия обязательна: IPC-пейлоад валиден только до конца тика.
      const copy = new Uint8Array(payload.data.slice(0));
      pendingRef.current.push({
        destLeft: payload.destLeft,
        destTop: payload.destTop,
        width: payload.width,
        height: payload.height,
        data: copy
      });
      if (rafRef.current === 0) {
        rafRef.current = window.requestAnimationFrame(flush);
      }
    };

    window.api.onRdpjsBitmap?.(handler);
    return () => {
      window.api.offRdpjsBitmap?.(handler as (...args: unknown[]) => void);
      if (rafRef.current !== 0) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      pendingRef.current = [];
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