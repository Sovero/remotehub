import { useState } from 'react';
import type { Group, Host, TreeNode } from '@shared/types';
import { countHosts } from '@shared/tree';
import { useApp } from '../store';
import ProtocolIcon from './ProtocolIcon';

export interface MenuRequest {
  x: number;
  y: number;
  node: TreeNode;
}

export default function TreeView({
  nodes,
  parentId,
  depth = 0,
  onMenu
}: {
  nodes: TreeNode[];
  parentId: string | null;
  depth?: number;
  onMenu: (req: MenuRequest) => void;
}): React.JSX.Element {
  return (
    <>
      {nodes.map((node) => (
        <TreeRow key={node.id} node={node} parentId={parentId} depth={depth} onMenu={onMenu} />
      ))}
    </>
  );
}

function TreeRow({
  node,
  parentId,
  depth,
  onMenu
}: {
  node: TreeNode;
  parentId: string | null;
  depth: number;
  onMenu: (req: MenuRequest) => void;
}): React.JSX.Element {
  if (node.kind === 'group') {
    return <GroupRow group={node} depth={depth} onMenu={onMenu} />;
  }
  return <HostRow host={node} parentId={parentId} depth={depth} onMenu={onMenu} />;
}

function useDragHandlers(
  onDrop: (e: React.DragEvent) => void
): {
  dragOver: boolean;
  handlers: {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
  };
} {
  const [dragOver, setDragOver] = useState(false);
  return {
    dragOver,
    handlers: {
      onDragOver: (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOver(true);
      },
      onDragLeave: () => setDragOver(false),
      onDrop: (e) => {
        e.preventDefault();
        setDragOver(false);
        onDrop(e);
      }
    }
  };
}

function GroupRow({
  group,
  depth,
  onMenu
}: {
  group: Group;
  depth: number;
  onMenu: (req: MenuRequest) => void;
}): React.JSX.Element {
  const toggleGroup = useApp((s) => s.toggleGroup);
  const moveNode = useApp((s) => s.moveNode);
  const { dragOver, handlers } = useDragHandlers((e) => {
    const id = e.dataTransfer.getData('text/plain');
    if (id && id !== group.id) void moveNode(id, group.id);
  });

  const hostCount = countHosts(group);

  return (
    <div>
      <div
        className={`tree-row tree-group${dragOver ? ' tree-row--drop' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', group.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        {...handlers}
        onClick={() => void toggleGroup(group.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onMenu({ x: e.clientX, y: e.clientY, node: group });
        }}
        title="Перетащите, чтобы переместить"
      >
        <span className={`chevron${group.collapsed ? ' chevron--closed' : ''}`}>▸</span>
        <span className="tree-folder">▣</span>
        <span className="tree-label">{group.name}</span>
        {hostCount > 0 && <span className="tree-count">{hostCount}</span>}
      </div>
      {!group.collapsed && (
        <TreeView nodes={group.children} parentId={group.id} depth={depth + 1} onMenu={onMenu} />
      )}
      {!group.collapsed && group.children.length === 0 && (
        <div className="tree-group-empty" style={{ paddingLeft: 6 + (depth + 1) * 14 + 22 }}>
          Группа пуста
        </div>
      )}
    </div>
  );
}

function HostRow({
  host,
  parentId,
  depth,
  onMenu
}: {
  host: Host;
  parentId: string | null;
  depth: number;
  onMenu: (req: MenuRequest) => void;
}): React.JSX.Element {
  const pushToast = useApp((s) => s.pushToast);
  const moveNode = useApp((s) => s.moveNode);
  const { dragOver, handlers } = useDragHandlers((e) => {
    const id = e.dataTransfer.getData('text/plain');
    if (id && id !== host.id) void moveNode(id, parentId, host.id);
  });

  return (
    <div
      className={`tree-row tree-host${dragOver ? ' tree-row--drop' : ''}`}
      style={{ paddingLeft: 6 + depth * 14 }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', host.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      {...handlers}
      onDoubleClick={() => pushToast('Подключение появится в следующей сборке (T03)')}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu({ x: e.clientX, y: e.clientY, node: host });
      }}
      title={`${host.protocol.toUpperCase()} · ${host.host}:${host.port ?? ''}`}
    >
      <span className="tree-icon">
        <ProtocolIcon protocol={host.protocol} />
      </span>
      <span className="tree-label tree-label--host">{host.name}</span>
      <span className="tree-sub">{host.host}</span>
      {host.tags.length > 0 && (
        <span className="tree-tags">
          {host.tags.slice(0, 2).map((t) => (
            <span key={t} className="tree-tag">
              {t}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
