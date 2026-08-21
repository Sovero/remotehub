import { useEffect, useMemo, useRef, useState } from 'react';
import type { CheckResult } from '@shared/ipc-contract';
import { defaultPort, type Host, type TreeNode } from '@shared/types';
import { collectTags, countHosts, filterTree, findParent, flattenHosts, matchesHostQuery } from '@shared/tree';
import { useApp } from '../store';
import ContextMenu, { type MenuItem } from './ContextMenu';
import SettingsForm from './SettingsForm';
import TreeView, { type HostStatusMap, type MenuRequest } from './TreeView';

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
    seq: number;
    host: Host;
    portNum: number;
    left: number;
    top: number;
    port: CheckResult | null;
    ping: CheckResult | null;
    startedAt: number;
    elapsed: number;
  }
  const [avail, setAvail] = useState<AvailState | null>(null);
  const availSeq = useRef(0);
  const activeCheck = useRef<{ port: string; ping: string } | null>(null);

  const [hostStatus, setHostStatus] = useState<HostStatusMap>({});
  const bulkSeq = useRef(0);
  const bulkReqs = useRef<Set<string>>(new Set());
  const bulkChecking = Object.values(hostStatus).some((s) => s.status === 'checking');

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

  const cancelCheck = (): void => {
    const req = activeCheck.current;
    if (req) {
      void window.api.checkCancel([req.port, req.ping]);
      activeCheck.current = null;
    }
  };

  const closeAvail = (): void => {
    cancelCheck();
    setAvail(null);
  };

  const checkAvailability = (host: Host): void => {
    cancelCheck();
    const row = document.querySelector<HTMLElement>(`.tree-host[data-host-id="${host.id}"]`);
    const rect = row?.getBoundingClientRect();
    const left = rect ? Math.min(rect.right + 10, window.innerWidth - 300) : Math.max(12, window.innerWidth - 300);
    const top = rect ? Math.min(rect.top, Math.max(12, window.innerHeight - 140)) : 60;
    const portNum = host.port ?? defaultPort(host.protocol);
    const seq = ++availSeq.current;
    const portId = `avail-port-${seq}`;
    const pingId = `avail-ping-${seq}`;
    activeCheck.current = { port: portId, ping: pingId };
    setAvail({ seq, host, portNum, left, top, port: null, ping: null, startedAt: Date.now(), elapsed: 0 });

    // Каждый зонд обновляет свою строку независимо, по мере завершения.
    void window.api.checkPort({ host: host.host, port: portNum, requestId: portId }).then((port) => {
      setAvail((a) => (a && a.seq === seq ? { ...a, port } : a));
    });
    void window.api.checkPing({ host: host.host, requestId: pingId }).then((ping) => {
      setAvail((a) => (a && a.seq === seq ? { ...a, ping } : a));
    });
  };

  const cancelBulk = (): void => {
    if (bulkReqs.current.size > 0) {
      void window.api.checkCancel([...bulkReqs.current]);
      bulkReqs.current.clear();
    }
  };

  const stopBulk = (): void => {
    bulkSeq.current += 1;
    cancelBulk();
    setHostStatus({});
  };

  const checkAllHosts = async (): Promise<void> => {
    const hosts = flattenHosts(tree);
    if (hosts.length === 0) return;
    cancelBulk();
    const seq = ++bulkSeq.current;
    const initial: HostStatusMap = {};
    for (const h of hosts) initial[h.id] = { status: 'checking' };
    setHostStatus(initial);

    // Небольшой пул воркеров, чтобы не устраивать «шторм» из N×(TCP+ping) одновременно.
    const queue = [...hosts];
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const host = queue.shift();
        if (!host || bulkSeq.current !== seq) return;
        const portNum = host.port ?? defaultPort(host.protocol);
        const portId = `bulk-${seq}-port-${host.id}`;
        const pingId = `bulk-${seq}-ping-${host.id}`;
        bulkReqs.current.add(portId);
        bulkReqs.current.add(pingId);
        const [port, ping] = await Promise.all([
          window.api.checkPort({ host: host.host, port: portNum, requestId: portId }),
          window.api.checkPing({ host: host.host, requestId: pingId })
        ]);
        bulkReqs.current.delete(portId);
        bulkReqs.current.delete(pingId);
        if (bulkSeq.current !== seq) return;
        const ok = port.ok || ping.ok;
        setHostStatus((m) => ({
          ...m,
          [host.id]: { status: ok ? 'ok' : 'fail', ms: ok ? (port.ms ?? ping.ms) : undefined }
        }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, hosts.length) }, () => worker()));
  };

  useEffect(() => {
    if (!avail) return;
    const close = (e: MouseEvent): void => {
      const tip = document.querySelector('.avail-tip');
      if (tip && !tip.contains(e.target as Node)) closeAvail();
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeAvail();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [avail]);

  // Отмена незавершённых проверок при размонтировании компонента.
  useEffect(
    () => () => {
      cancelCheck();
      bulkSeq.current += 1;
      cancelBulk();
    },
    []
  );

  // Пока хотя бы один зонд в работе — тикает живой счётчик прошедшего времени.
  const checking = avail !== null && (avail.port === null || avail.ping === null);
  useEffect(() => {
    if (!checking) return;
    const id = setInterval(() => {
      setAvail((a) => (a && (a.port === null || a.ping === null) ? { ...a, elapsed: Date.now() - a.startedAt } : a));
    }, 100);
    return () => clearInterval(id);
  }, [checking]);

  // Одиночная проверка из тултипа тоже обновляет точку в дереве.
  useEffect(() => {
    if (!avail || avail.port === null || avail.ping === null) return;
    const { host, port, ping } = avail;
    const ok = port.ok || ping.ok;
    const info: HostStatusMap[string] = { status: ok ? 'ok' : 'fail', ms: ok ? (port.ms ?? ping.ms) : undefined };
    setHostStatus((m) => ({ ...m, [host.id]: info }));
  }, [avail?.port, avail?.ping]);

  const fmtResult = (res: CheckResult | undefined, okLabel: string): string => {
    if (!res) return '…';
    if (res.ok) return res.ms != null ? `${okLabel} · ${res.ms} мс` : okLabel;
    return `недоступен${res.error ? ` · ${res.error}` : ''}`;
  };

  const fmtElapsed = (ms: number): string => (ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1)} с`);

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

  const pendingIndicator = (
    <span className="avail-checking">
      <span className="avail-spinner" aria-hidden="true" />
      Проверяю<span className="avail-dots"><i>.</i><i>.</i><i>.</i></span>
    </span>
  );

  return (
    <div className="sidebar-inner">
      <div className="sidebar-header">
        <span className="sidebar-title">Профили</span>
        <button
          className="btn btn--ghost btn--sm"
          title={bulkChecking ? 'Остановить проверку доступности' : 'Проверить доступность всех хостов'}
          onClick={() => (bulkChecking ? stopBulk() : void checkAllHosts())}
        >
          {bulkChecking ? '■' : '↻'}
        </button>
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
          <TreeView nodes={filtered} parentId={null} onMenu={(req) => setMenu(req)} statusMap={hostStatus} />
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
          <button className="avail-tip__close" aria-label="Закрыть" onClick={closeAvail}>
            ✕
          </button>
          <div className="avail-tip__host">
            {avail.host.name} · {avail.host.host}:{avail.portNum}
          </div>
          {checking && (
            <div className="avail-tip__timer" role="timer">
              Проверка идёт · {fmtElapsed(avail.elapsed)}
            </div>
          )}
          <div className={`avail-tip__row${avail.port ? (avail.port.ok ? ' ok' : ' bad') : ' avail-tip__pending'}`}>
            <span>TCP {avail.portNum}</span>
            {avail.port ? <span>{fmtResult(avail.port, 'открыт')}</span> : pendingIndicator}
          </div>
          <div className={`avail-tip__row${avail.ping ? (avail.ping.ok ? ' ok' : ' bad') : ' avail-tip__pending'}`}>
            <span>ICMP ping</span>
            {avail.ping ? <span>{fmtResult(avail.ping, 'отвечает')}</span> : pendingIndicator}
          </div>
        </div>
      )}
    </div>
  );
}
