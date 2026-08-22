import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import Icon from './Icon';

interface TourStep {
  /** CSS-селектор целевого элемента. */
  target: string;
  /** Заголовок тултипа. */
  title: string;
  /** Текст подсказки (можно с переносами строк). */
  body: string;
  /** Позиция тултипа относительно целевого элемента. */
  placement: 'bottom' | 'top' | 'right' | 'left';
  /** Отступ тултипа от элемента (px). */
  gap?: number;
}

const TOUR: TourStep[] = [
  {
    target: '.sidebar',
    title: 'Дерево профилей',
    body: 'Здесь живут ваши серверы. Группируйте их по проектам, окружениям или дата-центрам. Двойной клик по хосту открывает сессию.',
    placement: 'right',
    gap: 14
  },
  {
    target: '.sidebar-footer',
    title: 'Управление профилями',
    body: '＋ Группа — создать папку\n＋ Хост — добавить сервер\n🔑 Учётные данные — пароли и SSH-ключи\n⚙ Настройки — тема, шрифт, акцентный цвет',
    placement: 'right',
    gap: 14
  },
  {
    target: '.tabbar',
    title: 'Панель вкладок',
    body: 'Каждая открытая сессия — вкладка. Переключайтесь между ними (Ctrl+1…9), закрывайте (Ctrl+W). Средний клик мыши тоже закрывает.',
    placement: 'bottom'
  },
  {
    target: '.quick-connect',
    title: 'Быстрое подключение',
    body: 'Введите user@host[:port] и нажмите Enter — сессия откроется без создания профиля. Вкладку можно сохранить кнопкой 💾.',
    placement: 'bottom'
  },
  {
    target: '.snips',
    title: 'Сниппеты',
    body: 'Σ — часто используемые команды. Выберите сниппет — он отправится в активный терминал. Примеры: «перезапустить nginx», «посмотреть логи».',
    placement: 'bottom'
  },
  {
    target: '.sidebar-footer .btn--active, .sidebar-footer [title="Настройки"]',
    title: 'Настройки',
    body: '⚙ Настройки открывают панель в левой колонке: тема (светлая/тёмная), шрифт терминала, размер, акцентный цвет.',
    placement: 'right',
    gap: 14
  },
  {
    target: '.sidebar-header',
    title: 'Проверка доступности',
    body: '↻ — массовая проверка всех хостов: TCP-порт и ping. Результат виден точкой слева от имени хоста. Правый клик → «Проверить доступность» — для одного.',
    placement: 'right',
    gap: 14
  },
  {
    target: '.tabbar-new',
    title: 'Новая сессия',
    body: '＋ (Ctrl+Shift+T) — открыть диалог со списком всех хостов или ввести строку быстрого подключения.',
    placement: 'bottom'
  },
  {
    target: '.sidebar-search',
    title: 'Поиск и фильтрация',
    body: 'Ищите по имени, адресу или тегу. Выпадающий список фильтрует дерево по тегу — удобно, когда хостов много.',
    placement: 'right',
    gap: 14
  }
];

/** Вычисляет координаты тултипа относительно целевого элемента. */
function computeTooltip(
  targetRect: DOMRect,
  placement: TourStep['placement'],
  gap: number,
  tooltipW: number,
  tooltipH: number
): { left: number; top: number; arrow: string } {
  const margin = 12; // отступ от края окна
  let left = 0;
  let top = 0;
  let arrow = '';

  if (placement === 'bottom') {
    left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
    top = targetRect.bottom + gap;
    arrow = 'arrow-top';
  } else if (placement === 'top') {
    left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
    top = targetRect.top - tooltipH - gap;
    arrow = 'arrow-bottom';
  } else if (placement === 'right') {
    left = targetRect.right + gap;
    top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
    arrow = 'arrow-left';
  } else {
    left = targetRect.left - tooltipW - gap;
    top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
    arrow = 'arrow-right';
  }

  left = Math.max(margin, Math.min(left, window.innerWidth - tooltipW - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - tooltipH - margin));
  return { left, top, arrow };
}

export default function InteractiveTour(): React.JSX.Element {
  const [step, setStep] = useState(0);
  const finishOnboarding = useApp((s) => s.finishOnboarding);
  const closeOnboarding = useApp((s) => s.closeOnboarding);
  const [winSize, setWinSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [spotlight, setSpotlight] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const [tooltipArrow, setTooltipArrow] = useState('');
  const tooltipRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number>(0);
  const stepRef = useRef(step);
  stepRef.current = step;

  const current = TOUR[step];
  const isFirst = step === 0;
  const isLast = step === TOUR.length - 1;

  const goTo = useCallback((next: number): void => {
    const clamped = Math.max(0, Math.min(TOUR.length - 1, next));
    setStep(clamped);
  }, []);

  /** Находит целевой элемент по селектору и вычисляет позиции. */
  const layout = useCallback((): void => {
    const s = stepRef.current;
    const def = TOUR[s];
    if (!def) return;

    const el = document.querySelector<HTMLElement>(def.target);
    targetRef.current = el;
    if (!el) {
      setSpotlight(null);
      setTooltipStyle({ visibility: 'hidden' });
      return;
    }

    const rect = el.getBoundingClientRect();
    const pad = 6;
    setSpotlight({
      x: rect.left - pad,
      y: rect.top - pad,
      w: rect.width + pad * 2,
      h: rect.height + pad * 2
    });

    // Сначала показываем тултип скрытым, чтобы измерить его размеры,
    // затем вычисляем позицию и показываем.
    requestAnimationFrame(() => {
      const tip = tooltipRef.current;
      if (!tip) return;
      const tipRect = tip.getBoundingClientRect();
      const gap = def.gap ?? 10;
      const pos = computeTooltip(rect, def.placement, gap, tipRect.width, tipRect.height);
      setTooltipArrow(pos.arrow);
      setTooltipStyle({ left: pos.left, top: pos.top });
    });
  }, []);

  useLayoutEffect(() => {
    layout();
    // Ресайз/скролл пересчитывает позиции
    const onResize = (): void => {
      setWinSize({ w: window.innerWidth, h: window.innerHeight });
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(layout);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, { capture: true });
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, { capture: true });
      cancelAnimationFrame(rafRef.current);
    };
  }, [step, layout]);

  // Горячие клавиши: Esc — закрыть, стрелки — навигация
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        closeOnboarding();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(step + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(step - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, goTo, closeOnboarding]);

  return (
    <div className="tour-overlay">
      {/* Полупрозрачный фон с вырезанным spotlight */}
      <svg className="tour-spotlight-svg" viewBox={`0 0 ${winSize.w} ${winSize.h}`}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlight && (
              <rect
                x={spotlight.x}
                y={spotlight.y}
                width={spotlight.w}
                height={spotlight.h}
                rx={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.55)"
          mask="url(#tour-mask)"
        />
        {spotlight && (
          <rect
            x={spotlight.x}
            y={spotlight.y}
            width={spotlight.w}
            height={spotlight.h}
            rx={8}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="6 4"
            opacity={0.7}
          />
        )}
      </svg>

      {/* Тултип */}
      <div
        ref={tooltipRef}
        className={`tour-tooltip ${tooltipArrow}`}
        style={tooltipStyle}
      >
        <div className="tour-tooltip-step">
          {step + 1} / {TOUR.length}
        </div>
        <h3 className="tour-tooltip-title">{current.title}</h3>
        <div className="tour-tooltip-body">
          {current.body.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <div className="tour-tooltip-footer">
          <button className="btn btn--ghost btn--sm" onClick={closeOnboarding}>
            <Icon name="close" size={12} /> Пропустить
          </button>
          <span className="tour-tooltip-spacer" />
          {!isFirst && (
            <button className="btn btn--sm" onClick={() => goTo(step - 1)}>
              <Icon name="arrow-left" size={12} /> Назад
            </button>
          )}
          {isLast ? (
            <button className="btn btn--primary btn--sm" onClick={() => void finishOnboarding()}>
              <Icon name="check" size={12} /> Завершить
            </button>
          ) : (
            <button className="btn btn--primary btn--sm" onClick={() => goTo(step + 1)}>
              Далее <Icon name="arrow-right" size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}