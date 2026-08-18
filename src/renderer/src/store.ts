import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Group, Host, Settings, TreeNode } from '@shared/types';
import { createGroup, createHost } from '@shared/types';
import {
  applyImport,
  duplicateHost,
  findNode,
  findParent,
  insertNode,
  moveNode as treeMove,
  removeNode,
  replaceNode,
  type ImportMode
} from '@shared/tree';

let toastSeq = 0;

interface Toast {
  id: number;
  message: string;
}

export type DialogState =
  | { type: 'host'; host: Host | null; parentId: string | null }
  | { type: 'group'; group: Group | null; parentId: string | null }
  | { type: 'confirm'; title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void> }
  | { type: 'import' }
  | null;

interface AppState {
  tree: TreeNode[];
  settings: Settings;
  appInfo: { version: string; electron: string; platform: string } | null;
  ready: boolean;
  toasts: Toast[];
  dialog: DialogState;
  init: () => Promise<void>;
  saveTree: (tree: TreeNode[]) => Promise<void>;
  patchSettings: (patch: Partial<Settings>) => Promise<void>;
  pushToast: (message: string) => void;
  dismissToast: (id: number) => void;
  openDialog: (d: Exclude<DialogState, null>) => void;
  closeDialog: () => void;
  upsertHost: (host: Host, parentId: string | null) => Promise<void>;
  upsertGroup: (group: Group, parentId: string | null) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  toggleGroup: (id: string) => Promise<void>;
  moveNode: (id: string, targetParentId: string | null, afterId?: string | null) => Promise<void>;
  duplicateNode: (id: string) => Promise<void>;
  exportTree: () => Promise<void>;
  importTree: (mode: ImportMode) => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  tree: [],
  settings: {
    theme: 'dark',
    fontSize: 14,
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    accent: '#2d95ec',
    confirmOnDelete: true,
    restoreTabs: true,
    winBounds: null
  },
  appInfo: null,
  ready: false,
  toasts: [],
  dialog: null,

  init: async () => {
    const [profiles, settings, info] = await Promise.all([
      window.api.getProfiles(),
      window.api.getSettings(),
      window.api.appInfo()
    ]);
    set({
      tree: profiles.tree,
      settings: settings.settings,
      appInfo: info,
      ready: true
    });
    if (profiles.recovered) {
      get().pushToast('Файл профилей был повреждён — восстановлена пустая копия, повреждённый файл сохранён как .bak');
    }
    if (settings.recovered) {
      get().pushToast('Файл настроек был повреждён — применены настройки по умолчанию');
    }
  },

  saveTree: async (tree) => {
    await window.api.saveProfiles(tree);
    set({ tree });
  },

  patchSettings: async (patch) => {
    const res = await window.api.setSettings(patch);
    set({ settings: res.settings });
  },

  pushToast: (message) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, message }] }));
    setTimeout(() => get().dismissToast(id), 6000);
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  openDialog: (d) => set({ dialog: d }),
  closeDialog: () => set({ dialog: null }),

  upsertHost: async (host, parentId) => {
    const { tree } = get();
    const exists = findNode(tree, host.id) !== null;
    const next = exists ? replaceNode(tree, host.id, host) : insertNode(tree, host, parentId);
    await window.api.saveProfiles(next);
    set({ tree: next });
  },

  upsertGroup: async (group, parentId) => {
    const { tree } = get();
    const exists = findNode(tree, group.id) !== null;
    const next = exists ? replaceNode(tree, group.id, group) : insertNode(tree, group, parentId);
    await window.api.saveProfiles(next);
    set({ tree: next });
  },

  deleteNode: async (id) => {
    const { tree } = get();
    const next = removeNode(tree, id);
    await window.api.saveProfiles(next);
    set({ tree: next });
  },

  toggleGroup: async (id) => {
    const { tree } = get();
    const node = findNode(tree, id);
    if (!node || node.kind !== 'group') return;
    const next = replaceNode(tree, id, { ...node, collapsed: !node.collapsed });
    await window.api.saveProfiles(next);
    set({ tree: next });
  },

  moveNode: async (id, targetParentId, afterId) => {
    const { tree } = get();
    const next = treeMove(tree, id, targetParentId, afterId ?? null);
    if (next === tree) return; // перенос невозможен (цикл и т.п.)
    await window.api.saveProfiles(next);
    set({ tree: next });
  },

  duplicateNode: async (id) => {
    const { tree } = get();
    const node = findNode(tree, id);
    if (!node || node.kind !== 'host') return;
    const copy = duplicateHost(node);
    const parent = findParent(tree, id);
    const next = insertNode(tree, copy, parent?.id ?? null);
    await window.api.saveProfiles(next);
    set({ tree: next });
    get().pushToast(`Хост «${copy.name}» создан`);
  },

  exportTree: async () => {
    const res = await window.api.exportProfiles();
    if (res.ok) get().pushToast(`Профили экспортированы: ${res.path}`);
    else if (res.canceled) void 0;
    else get().pushToast(`Экспорт не удался: ${res.error ?? 'неизвестная ошибка'}`);
  },

  importTree: async (mode) => {
    const res = await window.api.importProfiles();
    if (!res.ok) {
      if (!res.canceled) get().pushToast(`Импорт не удался: ${res.error ?? 'неизвестная ошибка'}`);
      return;
    }
    const current = get().tree;
    const next = applyImport(current, res.tree ?? [], mode);
    await window.api.saveProfiles(next);
    set({ tree: next });
    get().pushToast(
      mode === 'replace'
        ? 'Дерево профилей заменено импортированным'
        : `Импортировано: добавлено ${(res.tree ?? []).length} узлов`
    );
  }
}));

export function makeHost(partial: Partial<Host> & { name: string; host: string }): Host {
  return createHost({ ...partial, id: partial.id ?? nanoid(10), protocol: partial.protocol ?? 'ssh' });
}

export function makeGroup(name: string): Group {
  return createGroup({ name, id: nanoid(10) });
}
