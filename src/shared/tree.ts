import type { Group, Host, TreeNode } from './types';
import { createGroup, createHost } from './types';
import { nanoid } from 'nanoid';

function isGroup(node: TreeNode): node is Group {
  return node.kind === 'group';
}

export function findNode(tree: TreeNode[], id: string): TreeNode | null {
  for (const node of tree) {
    if (node.id === id) return node;
    if (isGroup(node)) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Группа, в чьих children лежит узел, или null, если узел в корне/отсутствует. */
export function findParent(tree: TreeNode[], id: string): Group | null {
  for (const node of tree) {
    if (isGroup(node)) {
      if (node.children.some((c) => c.id === id)) return node;
      const deeper = findParent(node.children, id);
      if (deeper) return deeper;
    }
  }
  return null;
}

/** Заменяет узел по id; возвращает новое дерево. */
export function replaceNode(tree: TreeNode[], id: string, next: TreeNode): TreeNode[] {
  return tree.map((node) => {
    if (node.id === id) return next;
    if (isGroup(node)) {
      return { ...node, children: replaceNode(node.children, id, next) };
    }
    return node;
  });
}

/** Вставляет узел в конец children группы parentId или в корень, если parentId === null. */
export function insertNode(tree: TreeNode[], node: TreeNode, parentId: string | null): TreeNode[] {
  if (parentId === null) return [...tree, node];
  const parent = findNode(tree, parentId);
  if (!parent || !isGroup(parent)) return tree;
  return replaceNode(tree, parentId, { ...parent, children: [...parent.children, node] });
}

/** Удаляет узел (с поддеревом) по id; возвращает новое дерево. */
export function removeNode(tree: TreeNode[], id: string): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of tree) {
    if (node.id === id) continue;
    if (isGroup(node)) {
      result.push({ ...node, children: removeNode(node.children, id) });
    } else {
      result.push(node);
    }
  }
  return result;
}

/**
 * Переносит узел под новую группу (или в корень). Не даёт перенести узел
 * внутрь собственного поддерева (цикл). Возвращает исходное дерево, если
 * перенос невозможен.
 */
export function moveNode(
  tree: TreeNode[],
  id: string,
  targetParentId: string | null,
  afterId?: string | null
): TreeNode[] {
  const node = findNode(tree, id);
  if (!node) return tree;

  // Цикл: нельзя перенести узел внутрь собственного поддерева.
  if (targetParentId !== null && isInside(tree, id, targetParentId)) return tree;
  if (targetParentId === id) return tree;

  const without = removeNode(tree, id);

  // Ищем позицию «после» в целевом родителе уже в дереве без узла.
  const targetChildren = targetParentId === null ? without : childrenOf(without, targetParentId);
  if (targetChildren === null) return tree; // родитель пропал (например, был удалён вместе с узлом)
  if (afterId && !targetChildren.some((c) => c.id === afterId)) return tree;
  const idx = afterId ? targetChildren.findIndex((c) => c.id === afterId) + 1 : targetChildren.length;

  const insertAt = (list: TreeNode[]): TreeNode[] => {
    const arr = [...list];
    arr.splice(idx, 0, node);
    return arr;
  };

  if (targetParentId === null) return insertAt(without);
  const parent = findNode(without, targetParentId);
  if (!parent || !isGroup(parent)) return tree;
  return replaceNode(without, targetParentId, { ...parent, children: insertAt(parent.children) });
}

function childrenOf(tree: TreeNode[], id: string): TreeNode[] | null {
  const node = findNode(tree, id);
  if (!node) return null;
  return isGroup(node) ? node.children : null;
}

/** true, если targetId находится внутри поддерева узла id (строго). */
function isInside(tree: TreeNode[], id: string, targetId: string): boolean {
  const node = findNode(tree, id);
  if (!node || !isGroup(node)) return false;
  return node.children.some((c) => c.id === targetId || (isGroup(c) && isInside([c], id, targetId)));
}

export function flattenHosts(tree: TreeNode[]): Host[] {
  const out: Host[] = [];
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (isGroup(n)) walk(n.children);
      else out.push(n);
    }
  };
  walk(tree);
  return out;
}

export function countHosts(node: TreeNode): number {
  if (!isGroup(node)) return 1;
  return node.children.reduce((acc, c) => acc + countHosts(c), 0);
}

/** Копия хоста с новым id и суффиксом «(копия)». */
export function duplicateHost(host: Host): Host {
  return createHost({ ...host, id: nanoid(10), name: `${host.name} (копия)` });
}

/**
 * Фильтр дерева по предикату: группы остаются, если совпадают сами или
 * имеют совпадающих потомков; остальное отсекается.
 */
export function filterTree(tree: TreeNode[], predicate: (n: TreeNode) => boolean): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of tree) {
    if (isGroup(node)) {
      const children = filterTree(node.children, predicate);
      if (predicate(node) || children.length > 0) {
        out.push({ ...node, children });
      }
    } else if (predicate(node)) {
      out.push(node);
    }
  }
  return out;
}

export function collectTags(tree: TreeNode[]): string[] {
  const tags = new Set<string>();
  for (const host of flattenHosts(tree)) {
    for (const t of host.tags) tags.add(t);
  }
  return [...tags].sort((a, b) => a.localeCompare(b, 'ru'));
}

export function matchesHostQuery(host: Host, query: string, tag: string | null): boolean {
  const q = query.trim().toLowerCase();
  if (q) {
    const haystack = [host.name, host.host, host.username, ...host.tags]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (tag && !host.tags.includes(tag)) return false;
  return true;
}

// ---- импорт/экспорт ----

const EXPORT_APP = 'remote-hub';
const EXPORT_VERSION = 1;

export function buildExport(tree: TreeNode[]): string {
  return JSON.stringify(
    { app: EXPORT_APP, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), tree },
    null,
    2
  );
}

export type ParseExportResult = { ok: true; tree: TreeNode[] } | { ok: false; error: string };

function isValidNode(node: unknown, seen: Set<string>): node is TreeNode {
  if (typeof node !== 'object' || node === null) return false;
  const n = node as Record<string, unknown>;
  if (typeof n.id !== 'string' || n.id === '' || seen.has(n.id)) return false;
  seen.add(n.id);
  if (n.kind === 'group') {
    return typeof n.name === 'string' && Array.isArray(n.children) && n.children.every((c) => isValidNode(c, seen));
  }
  if (n.kind === 'host') {
    return (
      typeof n.name === 'string' &&
      typeof n.host === 'string' &&
      ['ssh', 'telnet', 'rdp', 'vnc'].includes(n.protocol as string)
    );
  }
  return false;
}

/** Разбирает и проверяет экспортированный файл профилей. */
export function parseProfileExport(raw: string): ParseExportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Файл не является корректным JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'Неверная структура файла' };
  }
  const p = parsed as Record<string, unknown>;
  if (p.app !== EXPORT_APP) {
    return { ok: false, error: 'Это не файл профилей Remote Hub' };
  }
  if (typeof p.version !== 'number' || p.version > EXPORT_VERSION) {
    return { ok: false, error: `Версия файла ${String(p.version)} не поддерживается` };
  }
  if (!Array.isArray(p.tree)) {
    return { ok: false, error: 'В файле нет дерева профилей' };
  }
  const seen = new Set<string>();
  if (!p.tree.every((n) => isValidNode(n, seen))) {
    return { ok: false, error: 'Дерево содержит некорректные узлы' };
  }
  return { ok: true, tree: p.tree as TreeNode[] };
}

/** Режимы импорта. */
export type ImportMode = 'merge' | 'replace';

/** Применяет импорт к текущему дереву; при merge перегенерирует id узлов, чтобы не было коллизий. */
export function applyImport(current: TreeNode[], incoming: TreeNode[], mode: ImportMode): TreeNode[] {
  if (mode === 'replace') return incoming;
  const existing = new Set<string>();
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      existing.add(n.id);
      if (n.kind === 'group') walk(n.children);
    }
  };
  walk(current);
  const reid = (node: TreeNode): TreeNode => {
    if (node.kind === 'group') {
      return createGroup({
        name: node.name,
        id: existing.has(node.id) ? nanoid(10) : node.id,
        collapsed: node.collapsed,
        children: node.children.map(reid)
      });
    }
    return createHost({ ...node, id: existing.has(node.id) ? nanoid(10) : node.id });
  };
  return [...current, ...incoming.map(reid)];
}
