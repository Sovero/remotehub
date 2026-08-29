import { useEffect } from 'react';
import Icon from '../Icon';

export default function Modal({
  title,
  children,
  onClose,
  width = 480,
  height,
  resizable = false
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
  height?: number;
  resizable?: boolean;
}): React.JSX.Element {
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className={`modal${resizable ? ' modal--resizable' : ''}`}
        style={{ width, height }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>{title}</span>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
