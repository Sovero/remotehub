import { useApp } from '../store';

export default function Welcome(): React.JSX.Element {
  const openDialog = useApp((s) => s.openDialog);

  return (
    <div className="welcome">
      <div className="welcome-logo">◈</div>
      <h1 className="welcome-title">Добро пожаловать в Remote Hub</h1>
      <p className="welcome-text">
        Один рабочий стол для ваших серверов: SSH, Telnet, RDP, VNC и SFTP —
        всё в дереве профилей, как в Termius.
      </p>
      <div className="welcome-actions">
        <button className="btn btn--primary" onClick={() => openDialog({ type: 'group', group: null, parentId: null })}>
          Добавить группу
        </button>
        <button className="btn btn--primary" onClick={() => openDialog({ type: 'host', host: null, parentId: null })}>
          Добавить хост
        </button>
      </div>
    </div>
  );
}
