import { useApp } from '../store';

export default function StatusBar(): React.JSX.Element {
  const appInfo = useApp((s) => s.appInfo);

  return (
    <footer className="statusbar">
      <span className="statusbar-item">Готово</span>
      <span className="statusbar-spacer" />
      {appInfo && (
        <span className="statusbar-item statusbar-muted">
          Remote Hub v{appInfo.version} · Electron {appInfo.electron} · {appInfo.platform}
        </span>
      )}
    </footer>
  );
}
