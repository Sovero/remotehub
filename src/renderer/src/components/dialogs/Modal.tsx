import { useEffect, useRef } from 'react';
import Icon from '../Icon';

export default function Modal({
  title,
  children,
  onClose,
  width = 480,
  height,
  resizable = false,
  onResize
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
  height?: number;
  resizable?: boolean;
  /** Вызывается перед onClose с фактическим размером — только для resizable. */
  onResize?: (size: { width: number; height: number }) => void;
}): React.JSX.Element {
  const modalRef = useRef<HTMLDivElement | null>(null);

  const handleClose = (): void => {
    if (resizable && onResize && modalRef.current) {
      const r = modalRef.current.getBoundingClientRect();
      onResize({ width: Math.round(r.width), height: Math.round(r.height) });
    }
    onClose();
  };

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, onResize, resizable]);

  return (
    <div className="modal-overlay" onMouseDown={handleClose}>
      <div
        ref={modalRef}
        className={`modal${resizable ? ' modal--resizable' : ''}`}
        style={{ width, height }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>{title}</span>
          <button className="modal-close" onClick={handleClose} aria-label="Закрыть">
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
