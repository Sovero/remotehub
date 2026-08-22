import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../store';
import Icon from '../Icon';
import { HELP_SECTIONS } from './helpContent';

export default function HelpDialog({
  sectionId,
  onClose
}: {
  sectionId?: string;
  onClose: () => void;
}): React.JSX.Element {
  const closeDialog = useApp((s) => s.closeDialog);
  const openOnboarding = useApp((s) => s.openOnboarding);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(() => sectionId ?? HELP_SECTIONS[0].id);
  const contentRef = useRef<HTMLElement>(null);

  // Если раздел задан извне (например, авто-открытие «Неполадок»), показываем его.
  useEffect(() => {
    if (sectionId) setActiveId(sectionId);
  }, [sectionId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return HELP_SECTIONS;
    return HELP_SECTIONS.filter((s) => `${s.title} ${s.keywords}`.toLowerCase().includes(q));
  }, [query]);

  // Esc — закрыть.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // При вводе поиска перескакиваем на первый подходящий раздел.
  useEffect(() => {
    if (filtered.length > 0 && !filtered.some((s) => s.id === activeId)) {
      setActiveId(filtered[0].id);
    }
  }, [filtered, activeId]);

  const select = (id: string): void => {
    setActiveId(id);
    contentRef.current?.scrollTo({ top: 0 });
  };

  const active = HELP_SECTIONS.find((s) => s.id === activeId) ?? HELP_SECTIONS[0];

  const startTour = (): void => {
    closeDialog();
    openOnboarding();
  };

  return (
    <div className="help-overlay" onMouseDown={onClose}>
      <div className="help" onMouseDown={(e) => e.stopPropagation()}>
        <header className="help-header">
          <div className="help-title">
            <span className="help-title-icon">?</span>
            <span>Справка Remote Hub</span>
          </div>
          <div className="help-header-actions">
            <button className="btn btn--sm" onClick={startTour}>
              <Icon name="play" size={12} /> Пройти тур
            </button>
            <button className="help-close" onClick={onClose} aria-label="Закрыть">
              <Icon name="close" size={12} />
            </button>
          </div>
        </header>

        <div className="help-body">
          <nav className="help-nav">
            <input
              className="input help-search"
              placeholder="Найти в справке…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="help-nav-list">
              {filtered.length === 0 ? (
                <div className="help-nav-empty">Ничего не найдено</div>
              ) : (
                filtered.map((s) => (
                  <button
                    key={s.id}
                    className={`help-nav-item${s.id === activeId ? ' help-nav-item--active' : ''}`}
                    onClick={() => select(s.id)}
                  >
                    <span className="help-nav-icon">{s.icon}</span>
                    <span>{s.title}</span>
                  </button>
                ))
              )}
            </div>
          </nav>

          {filtered.length === 0 ? (
            <div className="help-content help-content--empty">
              По запросу «{query}» ничего не найдено. Попробуйте другое слово.
            </div>
          ) : (
            <article className="help-content" ref={contentRef}>
              <h1 className="help-section-title">{active.title}</h1>
              {active.body}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
