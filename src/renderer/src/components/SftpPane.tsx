import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalEntry, SftpEntry, TransferProgress } from '@shared/ipc-contract';
import { findNode } from '@shared/tree';
import type { Host } from '@shared/types';
import { useApp, type SessionTab } from '../store';

interface Op {
  opId: string;
  name: string;
  direction: 'download' | 'upload';
  transferred: number;
  total: number;
  done: boolean;
  error?: string;
}

type Side = 'local' | 'remote';

function fmtSize(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${n} Б`;
}

function fmtTime(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** POSIX-join (пути на сервере всегда с «/»). */
function joinPosix(dir: string, name: string): string {
  if (!name || name === '.') return dir;
  if (dir === '/' || dir === '') return `/${name}`;
  return `${dir}/${name}`;
}

function parentOf(p: string): string {
  if (!p || p === '/') return '/';
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '/';
  return p.slice(0, idx);
}

function parentOfLocal(p: string): string {
  if (!p) return '';
  const norm = p.replace(/[\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('\\'), norm.lastIndexOf('/'));
  if (idx < 0) return norm + '\\';
  return norm.slice(0, idx + 1);
}

export default function SftpPane({ tab }: { tab: SessionTab }): React.JSX.Element {
  const tree = useApp((s) => s.tree);
  const openDialog = useApp((s) => s.openDialog);
  const pushToast = useApp((s) => s.pushToast);

  const host = useMemo((): Host | null => {
    if (tab.adHocHost) return tab.adHocHost;
    if (tab.hostId) {
      const node = findNode(tree, tab.hostId);
      if (node && node.kind === 'host') return node;
    }
    return null;
  }, [tab, tree]);

  const sessionId = tab.sessionId;

  const [localPath, setLocalPath] = useState<string>('');
  const [remotePath, setRemotePath] = useState<string>('/');
  const [localEntries, setLocalEntries] = useState<LocalEntry[] | null>(null);
  const [remoteEntries, setRemoteEntries] = useState<SftpEntry[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ side: Side; name: string } | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [rename, setRename] = useState<{ side: Side; dir: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [mkDir, setMkDir] = useState<{ side: Side; dir: string } | null>(null);
  const [mkDirValue, setMkDirValue] = useState('');
  const opsRef = useRef<Op[]>([]);

  const connected = tab.state.phase === 'connected';

  const loadLocal = useCallback(async (path: string) => {
    setLocalError(null);
    const res = await window.api.sftpLocalList(path);
    if (res.ok && res.entries) {
      setLocalEntries(res.entries);
      setLocalPath(path);
    } else {
      setLocalError(res.error ?? 'Не удалось прочитать каталог');
    }
  }, []);

  const loadRemote = useCallback(
    async (path: string) => {
      setRemoteError(null);
      const res = await window.api.sftpList(sessionId, path);
      if (res.ok && res.entries) {
        setRemoteEntries(res.entries);
        setRemotePath(path);
      } else {
        setRemoteError(res.error ?? 'Не удалось прочитать каталог');
      }
    },
    [sessionId]
  );

  // Первичная загрузка при подключении.
  useEffect(() => {
    if (!connected) return;
    void loadLocal(tab.sftpHome ?? '');
    void loadRemote('/');
  }, [connected, tab.sftpHome, loadLocal, loadRemote]);

  // Прогресс передач.
  useEffect(() => {
    const off = window.api.onSftpProgress((p: TransferProgress) => {
      if (p.sessionId !== sessionId) return;
      opsRef.current = mergeOps(opsRef.current, p);
      setOps([...opsRef.current]);
    });
    return off;
  }, [sessionId]);

  // Закрыть соединение при закрытии вкладки.
  useEffect(() => {
    return () => {
      void window.api.sftpClose(sessionId).catch(() => undefined);
    };
  }, [sessionId]);

  if (!connected) {
    return (
      <div className="sftp-pane sftp-pane--empty">
        {tab.state.phase === 'error' ? (
          <div className="sftp-error-panel">
            <div className="sftp-error-title">Не удалось открыть SFTP</div>
            <div className="sftp-error-msg">{tab.state.message}</div>
          </div>
        ) : (
          <div className="placeholder-panel">
            <div className="placeholder-icon">⇅</div>
            <p>Подключение SFTP…</p>
            <p className="placeholder-muted">{tab.title}</p>
          </div>
        )}
      </div>
    );
  }

  const navigate = (side: Side, name: string): void => {
    if (side === 'local') {
      const next = joinPosix(localPath, name);
      void loadLocal(next);
    } else {
      const next = joinPosix(remotePath, name);
      void loadRemote(next);
    }
    setSelected(null);
  };

  const goUp = (side: Side): void => {
    if (side === 'local') {
      const next = parentOfLocal(localPath);
      if (next !== localPath) void loadLocal(next);
    } else {
      const next = parentOf(remotePath);
      if (next !== remotePath) void loadRemote(next);
    }
    setSelected(null);
  };

  const refresh = (): void => {
    void loadLocal(localPath);
    void loadRemote(remotePath);
  };

  const requestDelete = (side: Side, name: string, isDir: boolean): void => {
    const dir = side === 'local' ? localPath : remotePath;
    const path = joinPosix(dir, name);
    const label = `${isDir ? 'папку' : 'файл'} «${name}»`;
    openDialog({
      type: 'confirm',
      title: 'Удаление',
      message: `Удалить ${label}${side === 'remote' ? ' на сервере' : ''}? Действие необратимо.`,
      confirmLabel: 'Удалить',
      danger: true,
      onConfirm: async () => {
        if (side === 'local') {
          const res = await window.api.localFsDelete(joinNative(dir, name), isDir);
          if (res.ok) void loadLocal(dir);
          else pushToast(res.error ?? 'Не удалось удалить');
          return;
        }
        const res = await window.api.sftpDelete(sessionId, path, isDir);
        if (res.ok) void loadRemote(dir);
        else pushToast(res.error ?? 'Не удалось удалить');
      }
    });
  };

  const submitRename = async (): Promise<void> => {
    if (!rename) return;
    const { side, dir, name } = rename;
    const newName = renameValue.trim();
    setRename(null);
    if (!newName || newName === name) return;
    if (side === 'local') {
      const res = await window.api.localFsRename(joinNative(dir, name), joinNative(dir, newName));
      if (res.ok) void loadLocal(dir);
      else pushToast(res.error ?? 'Не удалось переименовать');
      return;
    }
    const res = await window.api.sftpRename(sessionId, joinPosix(dir, name), joinPosix(dir, newName));
    if (res.ok) void loadRemote(dir);
    else pushToast(res.error ?? 'Не удалось переименовать');
  };

  const submitMkdir = async (): Promise<void> => {
    if (!mkDir) return;
    const { side, dir } = mkDir;
    const name = mkDirValue.trim();
    setMkDir(null);
    if (!name) return;
    if (side === 'local') {
      const res = await window.api.localFsMkdir(joinNative(dir, name));
      if (res.ok) void loadLocal(dir);
      else pushToast(res.error ?? 'Не удалось создать папку');
      return;
    }
    const res = await window.api.sftpMkdir(sessionId, joinPosix(dir, name));
    if (res.ok) void loadRemote(dir);
    else pushToast(res.error ?? 'Не удалось создать папку');
  };

  const startDownload = async (name: string): Promise<void> => {
    const res = await window.api.sftpDownload(sessionId, joinPosix(remotePath, name));
    if (!res.ok && !res.canceled) pushToast(res.error ?? 'Скачивание не удалось');
  };

  const startUpload = async (): Promise<void> => {
    const res = await window.api.sftpUpload(sessionId, remotePath);
    if (res.ok) void loadRemote(remotePath);
    else if (!res.canceled) pushToast(res.error ?? 'Загрузка не удалась');
  };

  const activeOps = ops.filter((o) => !o.done || o.error);
  const doneOps = ops.filter((o) => o.done && !o.error);

  return (
    <div className="sftp-pane">
      <div className="sftp-columns">
        <FilePane
          side="local"
          title="Локально"
          path={localPath}
          entries={localEntries}
          error={localError}
          selected={selected}
          canGoUp={parentOfLocal(localPath) !== localPath}
          onNavigate={(name) => navigate('local', name)}
          onSelect={(name) => setSelected({ side: 'local', name })}
          onGoUp={() => goUp('local')}
          onRename={(name) => setRename({ side: 'local', dir: localPath, name })}
          onDelete={(name, isDir) => requestDelete('local', name, isDir)}
          onNewFolder={() => setMkDir({ side: 'local', dir: localPath })}
          onRefresh={() => void loadLocal(localPath)}
        />
        <FilePane
          side="remote"
          title="Сервер"
          path={remotePath}
          entries={remoteEntries}
          error={remoteError}
          selected={selected}
          canGoUp={parentOf(remotePath) !== remotePath}
          onNavigate={(name) => navigate('remote', name)}
          onSelect={(name) => setSelected({ side: 'remote', name })}
          onGoUp={() => goUp('remote')}
          onRename={(name) => setRename({ side: 'remote', dir: remotePath, name })}
          onDelete={(name, isDir) => requestDelete('remote', name, isDir)}
          onNewFolder={() => setMkDir({ side: 'remote', dir: remotePath })}
          onRefresh={() => void loadRemote(remotePath)}
          onDownload={(name) => void startDownload(name)}
          onUpload={host ? () => void startUpload() : undefined}
        />
      </div>

      {rename && (
        <div className="sftp-inline">
          <span className="sftp-inline-label">Переименовать:</span>
          <input
            className="input"
            defaultValue={rename.name}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitRename();
              if (e.key === 'Escape') setRename(null);
            }}
            ref={(el) => {
              if (el) el.select();
            }}
          />
          <button className="btn btn--sm btn--primary" onClick={() => void submitRename()}>
            ОК
          </button>
        </div>
      )}
      {mkDir && (
        <div className="sftp-inline">
          <span className="sftp-inline-label">Новая папка:</span>
          <input
            className="input"
            placeholder="имя папки"
            autoFocus
            onChange={(e) => setMkDirValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitMkdir();
              if (e.key === 'Escape') setMkDir(null);
            }}
          />
          <button className="btn btn--sm btn--primary" onClick={() => void submitMkdir()}>
            ОК
          </button>
        </div>
      )}

      {(activeOps.length > 0 || doneOps.length > 0) && (
        <div className="sftp-transfers">
          {activeOps.map((o) => (
            <div key={o.opId} className={`sftp-op${o.error ? ' sftp-op--err' : ''}`}>
              <span className="sftp-op-name">
                {o.direction === 'upload' ? '↑' : '↓'} {o.name}
              </span>
              <span className="sftp-op-meta">
                {o.error
                  ? o.transferred > 0 && o.transferred < o.total
                    ? `${o.error} — файл неполный (${fmtSize(o.transferred)} из ${fmtSize(o.total)})`
                    : o.error
                  : `${fmtSize(o.transferred)} / ${fmtSize(o.total)}`}
              </span>
              {!o.error && (
                <div className="sftp-op-bar">
                  <div
                    className="sftp-op-bar-fill"
                    style={{ width: `${o.total > 0 ? Math.min(100, (o.transferred / o.total) * 100) : 0}%` }}
                  />
                </div>
              )}
            </div>
          ))}
          {doneOps.slice(-3).map((o) => (
            <div key={o.opId} className="sftp-op sftp-op--done">
              <span className="sftp-op-name">
                {o.direction === 'upload' ? '↑' : '↓'} {o.name}
              </span>
              <span className="sftp-op-meta">✓ {fmtSize(o.transferred)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Склейка локального пути (Windows-стиль). */
function joinNative(dir: string, name: string): string {
  if (!dir) return name;
  if (/[\\/]$/.test(dir)) return dir + name;
  return dir + '\\' + name;
}

function mergeOps(prev: Op[], p: TransferProgress): Op[] {
  const idx = prev.findIndex((o) => o.opId === p.opId);
  const op: Op = {
    opId: p.opId,
    name: p.name,
    direction: p.direction,
    transferred: p.transferred,
    total: p.total,
    done: p.done,
    error: p.error
  };
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = op;
    return next;
  }
  return [...prev, op];
}

function FilePane(props: {
  side: Side;
  title: string;
  path: string;
  entries: (SftpEntry | LocalEntry)[] | null;
  error: string | null;
  selected: { side: Side; name: string } | null;
  canGoUp: boolean;
  onNavigate: (name: string) => void;
  onSelect: (name: string) => void;
  onGoUp: () => void;
  onRename: (name: string) => void;
  onDelete: (name: string, isDir: boolean) => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onDownload?: (name: string) => void;
  onUpload?: () => void;
}): React.JSX.Element {
  const isRemote = props.side === 'remote';
  const sel = props.selected?.side === props.side ? props.selected.name : null;
  return (
    <div className={`sftp-pane-col${isRemote ? ' sftp-pane-col--remote' : ''}`}>
      <div className="sftp-col-head">
        <span className="sftp-col-title">{props.title}</span>
        <button className="btn btn--sm btn--ghost" title="Обновить" onClick={props.onRefresh}>
          ⟳
        </button>
        <button className="btn btn--sm btn--ghost" title="Вверх" disabled={!props.canGoUp} onClick={props.onGoUp}>
          ↑
        </button>
        {isRemote && props.onUpload && (
          <button className="btn btn--sm" title="Загрузить файл на сервер" onClick={props.onUpload}>
            ↑ Загрузить
          </button>
        )}
        <button className="btn btn--sm" title="Новая папка" onClick={props.onNewFolder}>
          ＋ Папка
        </button>
      </div>
      <div className="sftp-col-path" title={props.path}>
        {props.path || '—'}
      </div>
      <div className="sftp-col-list">
        {props.error ? (
          <div className="sftp-col-error">{props.error}</div>
        ) : props.entries === null ? (
          <div className="sftp-col-empty">Загрузка…</div>
        ) : props.entries.length === 0 ? (
          <div className="sftp-col-empty">Каталог пуст</div>
        ) : (
          props.entries.map((e) => {
            const isSel = sel === e.name;
            return (
              <div
                key={e.name}
                className={`sftp-row${isSel ? ' sftp-row--sel' : ''}`}
                onClick={() => props.onSelect(e.name)}
                onDoubleClick={() => {
                  if (e.isDirectory) props.onNavigate(e.name);
                  else if (isRemote && props.onDownload) props.onDownload(e.name);
                }}
              >
                <span className="sftp-row-name">
                  <span className={`sftp-ico${e.isDirectory ? ' sftp-ico--dir' : ''}`}>
                    {e.isDirectory ? '▸' : '▢'}
                  </span>
                  {e.name}
                </span>
                <span className="sftp-row-size">{e.isDirectory ? '—' : fmtSize(e.size)}</span>
                <span className="sftp-row-time">{fmtTime(e.mtime)}</span>
                {isSel && (
                  <span className="sftp-row-actions">
                    {e.isDirectory && (
                      <button className="btn btn--sm btn--ghost" title="Открыть" onClick={() => props.onNavigate(e.name)}>
                        ▶
                      </button>
                    )}
                    {!e.isDirectory && isRemote && props.onDownload && (
                      <button
                        className="btn btn--sm btn--ghost"
                        title="Скачать"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          props.onDownload?.(e.name);
                        }}
                      >
                        ↓
                      </button>
                    )}
                    <button
                      className="btn btn--sm btn--ghost"
                      title="Переименовать"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        props.onRename(e.name);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="btn btn--sm btn--ghost btn--danger"
                      title="Удалить"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        props.onDelete(e.name, e.isDirectory);
                      }}
                    >
                      🗑
                    </button>
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}


