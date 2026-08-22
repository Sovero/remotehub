import { useApp } from '../store';
import Icon from './Icon';

/** Тонкий баннер автообновления: проверка, скачивание, готовность к установке, ошибка. */
export default function UpdateBar(): React.JSX.Element | null {
  const update = useApp((s) => s.update);
  const checkUpdates = useApp((s) => s.checkUpdates);
  const downloadUpdate = useApp((s) => s.downloadUpdate);
  const installUpdate = useApp((s) => s.installUpdate);
  const dismissUpdate = useApp((s) => s.dismissUpdate);

  if (update.status === 'idle' || update.status === 'not-available') return null;

  if (update.status === 'checking') {
    return (
      <div className="update-bar update-bar--info">
        <span className="update-bar__text">Проверка обновлений…</span>
        <button className="update-bar__x" onClick={dismissUpdate} title="Скрыть" aria-label="Скрыть">
          <Icon name="close" size={10} />
        </button>
      </div>
    );
  }

  if (update.status === 'available') {
    return (
      <div className="update-bar update-bar--info">
        <span className="update-bar__text">
          Доступна версия <strong>{update.version}</strong>
        </span>
        <button className="btn btn--primary btn--sm" onClick={() => void downloadUpdate()}>
          <Icon name="download" size={12} /> Скачать
        </button>
        <button className="update-bar__x" onClick={dismissUpdate} title="Скрыть" aria-label="Скрыть">
          <Icon name="close" size={10} />
        </button>
      </div>
    );
  }

  if (update.status === 'downloading') {
    const pct = Math.max(0, Math.min(100, update.percent));
    return (
      <div className="update-bar update-bar--info">
        <span className="update-bar__text">Скачивание обновления… {pct}%</span>
        <div className="update-bar__progress">
          <div className="update-bar__progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (update.status === 'downloaded') {
    return (
      <div className="update-bar update-bar--success">
        <span className="update-bar__text">
          Версия <strong>{update.version}</strong> готова к установке
        </span>
        <button className="btn btn--primary btn--sm" onClick={() => void installUpdate()}>
          <Icon name="power" size={12} /> Перезапустить и установить
        </button>
        <button className="btn btn--sm" onClick={dismissUpdate}>
          Позже
        </button>
      </div>
    );
  }

  // status === 'error'
  return (
    <div className="update-bar update-bar--error">
      <span className="update-bar__text" title={update.message}>
        Ошибка обновления: {update.message}
      </span>
      <button className="btn btn--sm" onClick={() => void checkUpdates()}>
        <Icon name="refresh" size={12} /> Повторить
      </button>
      <button className="update-bar__x" onClick={dismissUpdate} title="Скрыть" aria-label="Скрыть">
        <Icon name="close" size={10} />
      </button>
    </div>
  );
}
