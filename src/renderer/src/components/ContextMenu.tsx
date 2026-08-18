import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}

export default function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const menuWidth = 220;
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - menuWidth - 8),
    top: Math.min(y, window.innerHeight - items.length * 30 - 16)
  };

  return (
    <div className="ctxmenu" ref={ref} style={style}>
      {items.map((item) => (
        <button
          key={item.label}
          className={`ctxmenu-item${item.danger ? ' ctxmenu-item--danger' : ''}`}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.action();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
