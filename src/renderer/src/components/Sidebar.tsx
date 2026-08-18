import { useApp } from '../store';

export default function Sidebar(): React.JSX.Element {
  const tree = useApp((s) => s.tree);
  const pushToast = useApp((s) => s.pushToast);

  return (
    <div className="sidebar-inner">
      <div className="sidebar-header">
        <span className="sidebar-title">Профили</span>
      </div>
      <div className="sidebar-body">
        {tree.length === 0 ? (
          <div className="sidebar-empty">
            <p>Пока нет ни одного профиля.</p>
            <div className="sidebar-empty-actions">
              <button
                className="btn btn--ghost"
                onClick={() => pushToast('Добавление группы появится в следующей сборке')}
              >
                ＋ Группа
              </button>
              <button
                className="btn btn--ghost"
                onClick={() => pushToast('Добавление хоста появится в следующей сборке')}
              >
                ＋ Хост
              </button>
            </div>
          </div>
        ) : (
          <div className="sidebar-empty">
            <p>Дерево профилей появится в следующей сборке.</p>
          </div>
        )}
      </div>
    </div>
  );
}
