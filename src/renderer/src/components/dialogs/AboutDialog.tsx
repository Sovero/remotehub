import { useEffect, useState } from 'react';
import { findChangelogEntry, type ChangelogEntry } from '@shared/changelog';
import { useApp } from '../../store';
import Icon from '../Icon';
import Modal from './Modal';

export default function AboutDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const appInfo = useApp((s) => s.appInfo);
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.api
      .getChangelog()
      .then((res) => {
        if (!alive) return;
        if (res.ok && res.entries) setEntries(res.entries);
        else setError(res.error ?? 'Не удалось загрузить список изменений');
      })
      .catch(() => {
        if (alive) setError('Не удалось загрузить список изменений');
      });
    return () => {
      alive = false;
    };
  }, []);

  const current = findChangelogEntry(entries ?? [], appInfo?.version ?? '');

  return (
    <Modal title="О программе" onClose={onClose} width={460}>
      <div className="about">
        <div className="about-head">
          <div className="about-logo">
            <Icon name="window" size={26} />
          </div>
          <div>
            <div className="about-name">Remote Hub</div>
            <div className="about-meta">
              v{appInfo?.version ?? '—'} · Electron {appInfo?.electron ?? '—'} · {appInfo?.arch ?? '—'}
            </div>
          </div>
        </div>

        <div className="about-section-title">Что нового в этой версии</div>
        {error && <div className="about-error">{error}</div>}
        {!error && !current && <div className="about-empty">Список изменений пока пуст.</div>}
        {!error && current && (
          <div className="about-changelog">
            <div className="about-changelog-version">
              Версия {current.version}
              {current.date ? ` · ${current.date}` : ''}
            </div>
            {current.sections.length === 0 && <div className="about-empty">Записей нет.</div>}
            {current.sections.map((s) => (
              <div key={s.title} className="about-changelog-section">
                <div className="about-changelog-title">{s.title}</div>
                <ul>
                  {s.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="about-footer">
          <Icon name="key" size={11} /> MIT License · исходный код на GitHub
        </div>
      </div>
    </Modal>
  );
}
