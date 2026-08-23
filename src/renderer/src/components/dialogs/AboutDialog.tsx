import { useEffect, useState } from 'react';
import { findChangelogEntry, type ChangelogEntry } from '@shared/changelog';
import { useApp } from '../../store';
import Icon from '../Icon';
import Modal from './Modal';

export default function AboutDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const appInfo = useApp((s) => s.appInfo);
  const update = useApp((s) => s.update);
  const checkUpdates = useApp((s) => s.checkUpdates);
  const downloadUpdate = useApp((s) => s.downloadUpdate);
  const installUpdate = useApp((s) => s.installUpdate);
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

        <div className="about-section-title">Обновления</div>
        <div className="about-update">
          {update.status === 'checking' && (
            <div className="about-update__row">
              <Icon name="spinner" size={12} className="icon-spin" /> Проверка обновлений…
            </div>
          )}
          {update.status === 'available' && (
            <>
              <div className="about-update__row">
                <Icon name="download" size={12} /> Доступна версия <strong>{update.version}</strong>
              </div>
              {update.releaseNotes && (
                <div className="about-update__notes">{update.releaseNotes}</div>
              )}
              <div className="about-update__actions">
                <button className="btn btn--primary btn--sm" onClick={() => void downloadUpdate()}>
                  <Icon name="download" size={12} /> Скачать
                </button>
              </div>
            </>
          )}
          {update.status === 'downloading' && (
            <div className="about-update__row">
              <Icon name="spinner" size={12} className="icon-spin" /> Скачивание обновления…{' '}
              {Math.max(0, Math.min(100, update.percent))}%
            </div>
          )}
          {update.status === 'downloaded' && (
            <div className="about-update__row">
              <Icon name="check" size={12} /> Версия <strong>{update.version}</strong> готова к установке
            </div>
          )}
          {update.status === 'error' && (
            <div className="about-update__row about-update__row--error" title={update.message}>
              <Icon name="warning" size={12} /> Ошибка обновления: {update.message}
            </div>
          )}
          {update.status === 'idle' && (
            <div className="about-update__row about-update__muted">Проверка обновлений ещё не запускалась.</div>
          )}
          {update.status === 'not-available' && (
            <div className="about-update__row">
              <Icon name="check" size={12} /> Установлена последняя версия
            </div>
          )}
          <div className="about-update__actions">
            {(update.status === 'idle' || update.status === 'not-available' || update.status === 'error') && (
              <button className="btn btn--sm" onClick={() => void checkUpdates()}>
                <Icon name="refresh" size={12} /> Проверить обновления
              </button>
            )}
            {update.status === 'downloaded' && (
              <button className="btn btn--primary btn--sm" onClick={() => void installUpdate()}>
                <Icon name="power" size={12} /> Перезапустить и установить
              </button>
            )}
          </div>
        </div>

        <div className="about-footer">
          <Icon name="key" size={11} /> MIT License · исходный код на GitHub
        </div>
      </div>
    </Modal>
  );
}
