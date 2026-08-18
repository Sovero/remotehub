import { useEffect } from 'react';
import { useApp } from './store';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import StatusBar from './components/StatusBar';
import Welcome from './components/Welcome';
import Toasts from './components/Toasts';

export default function App(): React.JSX.Element {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);
  const tree = useApp((s) => s.tree);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const unsubscribe = window.api.onNotify((message) => {
      useApp.getState().pushToast(message);
    });
    return unsubscribe;
  }, []);

  if (!ready) {
    return (
      <div className="app app--loading">
        <div className="loading">Загрузка…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <Sidebar />
      </aside>
      <main className="workspace">
        <TabBar />
        <section className="content">
          {tree.length === 0 ? <Welcome /> : <EmptyWorkspace />}
        </section>
      </main>
      <StatusBar />
      <Toasts />
    </div>
  );
}

function EmptyWorkspace(): React.JSX.Element {
  return (
    <div className="placeholder-panel">
      <div className="placeholder-icon">▤</div>
      <p>Выберите профиль в дереве слева, чтобы открыть сессию.</p>
      <p className="placeholder-muted">Терминалы, RDP и VNC появятся здесь.</p>
    </div>
  );
}
