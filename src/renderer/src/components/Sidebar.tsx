import { useEffect, useMemo, useState } from 'react';
import type { CheckResult } from '@shared/ipc-contract';
import { defaultPort, type Host, type TreeNode } from '@shared/types';
import { collectTags, countHosts, filterTree, findParent, matchesHostQuery } from '@shared/tree';
import { useApp } from '../store';
import ContextMenu, { type MenuItem } from './ContextMenu';
import SettingsForm from './SettingsForm';
import TreeView, { type MenuRequest } from './TreeView';

export default function Sidebar(): React.JSX.Element {
  const tree = useApp((s) => s.tree);
  const openDialog = useApp((s) => s.openDialog);
  const deleteNode = useApp((s) => s.deleteNode);
  const duplicateNode = useApp((s) => s.duplicateNode);
  const moveNode = useApp((s) => s.moveNode);
  const openSession = useApp((s) => s.openSession);
  const openSftp = useApp((s) => s.openSftp);
  const exportTree = useApp((s) => s.exportTree);
  const settings = useApp((s) => s.settings);

  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [rootDrop, setRootDrop] = useState(false);
  const view = useApp((s) => s.sidebarView);
  const setView = useApp((s) => s.setSidebarView);

  interface AvailState {
    host: Host;
    portNum: number;
    left: number;
    top: number;
    status: 'checking' | 'done';
    port?: CheckResult;
    ping?: CheckResult;
  }
  const [avail, setAvail] = useState<AvailState | null>(null);

  const tags = useMemo(() => collectTags(tree), [tree]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filterTree(
      tree,
      (n) => (n.kind === 'host' ? matchesHostQuery(n, q, tag) : q !== '' && n.name.toLowerCase().includes(q))
    );
  }, [tree, query, tag]);

  const hasFilter = query.trim() !== '' || tag !== null;

  const requestDelete = (node: TreeNode): void => {
    if (!settings.confirmOnDelete) {
      void deleteNode(node.id);
      return;
    }
    const message =
      node.kind === 'group'
        ? `Удалить группу «${node.name}» и ${countHosts(node)} хостов внутри? Действие необратимо.`
        : `Удалить хост «${node.name}»? Действие необратимо.`;
    openDialog({
      type: 'confirm',
      title: 'Удаление',
      message,
      confirmLabel: 'Удалить',
      danger: true,
      onConfirm: () => deleteNode(node.id)
    });
  };

  const checkAvailability = (host: Host): void => {
    const row = document.querySelector<HTMLElement>(`.tree-host[data-host-id="${host.id}"]`);
    const rect = row?.getBoundingClientRect();
    const left = rect ? Math.min(rect.right + 10, window.innerWidth - 300) : Math.max(12, window.innerWidth - 300);
    const top = rect ? Math.min(rect.top, Math.max(12, window.innerHeight - 140)) : 60;
    const portNum = host.port ?? defaultPort(host.protocol);
    setAvail({ host, portNum, left, top, status: 'checking' });
    void Promise.all([window.api.checkPort({ host: host.host, port: portNum }), window.api.checkPing(host.host)]).then(
      ([port, ping]) => {
        setAvail((a) => (a && a.host.id === host.id ? { ...a, status: 'done', port, ping } : a));
      }
    );
  };

  useEffect(() => {
    if (!avail) return;
    const close = (e: MouseEvent): void => {
      const tip = document.querySelector('.avail-tip');
      if (tip && !tip.contains(e.target as Node)) setAvail(null);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAvail(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [avail]);

  const fmtResult = (res: CheckResult | undefined, okLabel: string): string => {
    if (!res) return '…';
    if (res.ok) return res.ms != null ? `${okLabel} · ${res.ms} мс` : okLabel;
    return `недоступен${res.error ? ` · ${res.error}` : ''}`;
  };

  const buildMenu = (node: TreeNode): MenuItem[] => {
    if (node.kind === 'group') {
      return [
        { label: 'Добавить хост сюда…', action: () => openDialog({ type: 'host', host: null, parentId: node.id }) },
        { label: 'Добавить группу сюда…', action: () => openDialog({ type: 'group', group: null, parentId: node.id }) },
        {
          label: 'Переименовать…',
          action: () => openDialog({ type: 'group', group: node, parentId: findParent(tree, node.id)?.id ?? null })
        },
        { label: 'Удалить', danger: true, action: () => requestDelete(node) }
      ];
    }
    const host = node as Host;
    const items: MenuItem[] = [{ label: 'Подключить', action: () => void openSession(host) }];
    if (host.protocol === 'ssh') {
      items.push({ label: 'SFTP', action: () => void openSftp(host) });
    }
    items.push(
      { label: 'Проверить доступность', action: () => checkAvailability(host) },
      {
        label: 'Изменить…',
        action: () => openDialog({ type: 'host', host, parentId: findParent(tree, host.id)?.id ?? null })
      },
      { label: 'Дублировать', action: () => void duplicateNode(host.id) },
      { label: 'Удалить', danger: true, action: () => requestDelete(host) }
    );
    return items;
  };

  const onRootDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setRootDrop(false);
    const id = e.dataTransfer.getData('text/plain');
    if (id) void moveNode(id, null);
  };

  return (
    <div className="sidebar-inner">
      <div className="sidebar-header">
        <span className="sidebar-title">Профили</span>
      </div>

      <div className="sidebar-search">
        <input
          className="input input--search"
          placeholder="Поиск: имя, адрес, тег…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {tags.length > 0 && (
          <select className="input input--tag" value={tag ?? ''} onChange={(e) => setTag(e.target.value || null)}>
            <option value="">Все теги</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        )}
      </div>

      <div
        className={`sidebar-body${rootDrop ? ' sidebar-body--drop' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setRootDrop(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setRootDrop(false);
        }}
        onDrop={onRootDrop}
      >
        {filtered.length === 0 ? (
          hasFilter ? (
            <div className="sidebar-empty">
              <p>Ничего не найдено.</p>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setQuery('');
                  setTag(null);
                }}
              >
                Сбросить фильтр
              </button>
            </div>
          ) : (
            <div className="sidebar-empty">
              <p>Пока нет ни одного профиля.</p>
              <p className="sidebar-hint">Добавьте группу или хост, чтобы начать.</p>
            </div>
          )
        ) : (
          <TreeView nodes={filtered} parentId={null} onMenu={(req) => setMenu(req)} />
        )}
      </div>

      {view === 'settings' && (
        <div className="sidebar-settings-sheet">
          <div className="sidebar-settings-sheet__head">
            <span>Настройки</span>
            <button className="btn btn--ghost btn--sm" onClick={() => setView('tree')} title="Закрыть настройки">
              ✕
            </button>
          </div>
          <SettingsForm />
        </div>
      )}

      <div className="sidebar-footer">
        <button className="btn btn--sm" onClick={() => openDialog({ type: 'group', group: null, parentId: null })}>
          ＋ Группа
        </button>
        <button className="btn btn--sm" onClick={() => openDialog({ type: 'host', host: null, parentId: null })}>
          ＋ Хост
        </button>
        <button className="btn btn--sm" onClick={() => openDialog({ type: 'import' })}>
          Импорт
        </button>
        <button className="btn btn--sm" onClick={() => void exportTree()}>
          Экспорт
        </button>
        <button className="btn btn--sm" title="Наборы учётных данных" onClick={() => openDialog({ type: 'credentials' })}>
          🔑 Учётные данные
        </button>
        <button
          className={`btn btn--sm${view === 'settings' ? ' btn--active' : ''}`}
          title="Настройки"
          onClick={() => setView(view === 'settings' ? 'tree' : 'settings')}
        >
          ⚙ Настройки
        </button>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={buildMenu(menu.node)} onClose={() => setMenu(null)} />}

      {avail && (
        <div className="avail-tip" style={{ left: avail.left, top: avail.top }} role="status">
          <button className="avail-tip__close" aria-label="Закрыть" onClick={() => setAvail(null)}>
            ✕
          </button>
          <div className="avail-tip__host">
            {avail.host.name} · {avail.host.host}:{avail.portNum}
          </div>
          {avail.status === 'checking' ? (
            <div className="avail-tip__row avail-tip__pending">Проверяю…</div>
          ) : (
            <>
              <div className={`avail-tip__row${avail.port?.ok ? ' ok' : ' bad'}`}>
                <span>TCP {avail.portNum}</span>
                <span>{fmtResult(avail.port, 'открыт')}</span>
              </div>
              <div className={`avail-tip__row${avail.ping?.ok ? ' ok' : ' bad'}`}>
                <span>ICMP ping</span>
                <span>{fmtResult(avail.ping, 'отвечает')}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
