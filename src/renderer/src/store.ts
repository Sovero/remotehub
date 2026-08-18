import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Group, Host, Settings, Snippet, TreeNode } from '@shared/types';
import { createGroup, createHost } from '@shared/types';
import type { SessionState } from '@shared/ipc-contract';
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

export interface SessionTab {
  sessionId: string;
  hostId: string | null;
  title: string;
  protocol: string;
  kind: 'terminal' | 'vnc' | 'rdp' | 'sftp';
  state: SessionState;
  adHocHost: Host | null;
  startedAt: number | null;
}

export type DialogState =
  | { type: 'host'; host: Host | null; parentId: string | null }
  | { type: 'group'; group: Group | null; parentId: string | null }
  | { type: 'confirm'; title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void> }
  | { type: 'import' }
  | { type: 'password'; sessionId: string; title: string; detail: string }
  | { type: 'new-session' }
  | { type: 'credentials' }
  | { type: 'settings' }
  | { type: 'snippets' }
  | { type: 'hotkeys' }
  | null;

interface AppState {
  tree: TreeNode[];
  settings: Settings;
  appInfo: { version: string; electron: string; platform: string } | null;
  ready: boolean;
  toasts: Toast[];
  dialog: DialogState;
  tabs: SessionTab[];
  activeTabId: string | null;
  init: () => Promise<void>;
  saveTree: (tree: TreeNode[]) => Promise<void>;
  setTree: (tree: TreeNode[]) => void;
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
  // сессии
  openSession: (host: Host, opts?: { password?: string; adHoc?: boolean }) => Promise<void>;
  openAdHoc: (host: Host) => Promise<void>;
  reconnectTab: (sessionId: string) => Promise<void>;
  closeTab: (sessionId: string, force?: boolean) => Promise<void>;
  switchTab: (sessionId: string) => void;
  submitPassword: (sessionId: string, password: string) => Promise<void>;
  applySessionState: (sessionId: string, state: SessionState) => void;
  saveAdHocAsProfile: (sessionId: string) => Promise<void>;
  persistTabs: () => void;
  saveSnippet: (snippet: Snippet) => Promise<void>;
  deleteSnippet: (id: string) => Promise<void>;
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
    winBounds: null,
    openTabs: [],
    snippets: []
  },
  appInfo: null,
  ready: false,
  toasts: [],
  dialog: null,
  tabs: [],
  activeTabId: null,

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
    // Восстановление вкладок (A05): только хосты, существующие в дереве.
    if (settings.settings.restoreTabs && settings.settings.openTabs.length > 0) {
      const restored: SessionTab[] = [];
      for (const meta of settings.settings.openTabs) {
        if (meta.kind !== 'terminal') continue;
        if (meta.hostId) {
          const node = findNode(profiles.tree, meta.hostId);
          if (!node || node.kind !== 'host') continue;
          restored.push({
            sessionId: meta.sessionId,
            hostId: meta.hostId,
            title: node.name,
            protocol: node.protocol,
            kind: 'terminal',
            state: { phase: 'closed', reason: 'Вкладка восстановлена после перезапуска' },
            adHocHost: null,
            startedAt: null
          });
        } else if (meta.adHocHost) {
          restored.push({
            sessionId: meta.sessionId,
            hostId: null,
            title: meta.title,
            protocol: meta.adHocHost.protocol,
            kind: 'terminal',
            state: { phase: 'closed', reason: 'Вкладка восстановлена после перезапуска' },
            adHocHost: meta.adHocHost,
            startedAt: null
          });
        }
      }
      if (restored.length > 0) {
        set({ tabs: restored, activeTabId: restored[0].sessionId });
      }
    }
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

  setTree: (tree) => set({ tree }),

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
    if (next === tree) return;
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
  },

  // ---- сессии ----

  openSession: async (host, opts) => {
    const sessionId = nanoid(10);
    const tab: SessionTab = {
      sessionId,
      hostId: host.id,
      title: host.name,
      protocol: host.protocol,
      kind: 'terminal',
      state: { phase: 'connecting' },
      adHocHost: opts?.adHoc ? host : null,
      startedAt: null
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: sessionId }));
    const res = await window.api.openSession({ host, password: opts?.password });
    // sessionId из main может отличаться (для ad-hoc), синхронизируем
    if (res.sessionId && res.sessionId !== sessionId) {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, sessionId: res.sessionId } : t)),
        activeTabId: res.sessionId
      }));
    }
    get().persistTabs();
  },

  openAdHoc: async (host) => {
    await get().openSession(host, { adHoc: true });
  },

  reconnectTab: async (sessionId) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.sessionId === sessionId);
    if (!tab) return;
    await window.api.sessionClose(sessionId);
    let host: Host | null = tab.adHocHost;
    if (!host && tab.hostId) {
      const node = findNode(get().tree, tab.hostId);
      if (node && node.kind === 'host') host = node;
    }
    if (!host) {
      get().pushToast('Профиль хоста не найден — удалите вкладку');
      return;
    }
    const newId = nanoid(10);
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.sessionId === sessionId
          ? { ...t, sessionId: newId, state: { phase: 'connecting' }, startedAt: null }
          : t
      ),
      activeTabId: newId
    }));
    const res = await window.api.openSession({ host });
    if (res.sessionId !== newId) {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.sessionId === newId ? { ...t, sessionId: res.sessionId } : t)),
        activeTabId: res.sessionId
      }));
    }
    get().persistTabs();
  },

  closeTab: async (sessionId, force) => {
    const { tabs, settings } = get();
    const tab = tabs.find((t) => t.sessionId === sessionId);
    if (!tab) return;
    const connected = tab.state.phase === 'connected' || tab.state.phase === 'connecting';
    if (connected && !force && settings.confirmOnDelete) {
      get().openDialog({
        type: 'confirm',
        title: 'Закрыть вкладку',
        message: `Закрыть подключение «${tab.title}»?`,
        confirmLabel: 'Закрыть',
        danger: true,
        onConfirm: () => get().closeTab(sessionId, true)
      });
      return;
    }
    await window.api.sessionClose(sessionId);
    set((s) => {
      const tabsAfter = s.tabs.filter((t) => t.sessionId !== sessionId);
      return {
        tabs: tabsAfter,
        activeTabId: s.activeTabId === sessionId ? (tabsAfter[0]?.sessionId ?? null) : s.activeTabId
      };
    });
    get().persistTabs();
  },

  switchTab: (sessionId) => set({ activeTabId: sessionId }),

  submitPassword: async (sessionId, password) => {
    await window.api.sessionAuth(sessionId, password);
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.sessionId === sessionId ? { ...t, state: { phase: 'connecting' } } : t
      )
    }));
  },

  applySessionState: (sessionId, state) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.sessionId !== sessionId) return t;
        return {
          ...t,
          state,
          startedAt: state.phase === 'connected' ? (t.startedAt ?? Date.now()) : t.startedAt
        };
      })
    }));
    if (state.phase === 'auth-required') {
      const tab = get().tabs.find((t) => t.sessionId === sessionId);
      if (tab) {
        get().openDialog({
          type: 'password',
          sessionId,
          title: `Пароль: ${tab.title}`,
          detail: state.detail ?? 'Введите пароль'
        });
      }
    }
  },

  saveAdHocAsProfile: async (sessionId) => {
    const tab = get().tabs.find((t) => t.sessionId === sessionId);
    if (!tab?.adHocHost) return;
    const host = tab.adHocHost;
    const node = findNode(get().tree, host.id);
    if (node) {
      get().pushToast('Такой профиль уже существует');
      return;
    }
    const saved = createHost({ ...host, id: nanoid(10) });
    const next = insertNode(get().tree, saved, null);
    await window.api.saveProfiles(next);
    set({ tree: next, tabs: get().tabs.map((t) => (t.sessionId === sessionId ? { ...t, hostId: saved.id, adHocHost: null } : t)) });
    get().persistTabs();
    get().pushToast(`Профиль «${saved.name}» сохранён`);
  },

  persistTabs: () => {
    const { tabs, settings } = get();
    void get().patchSettings({
      ...settings,
      openTabs: tabs.map((t) => ({
        sessionId: t.sessionId,
        hostId: t.hostId,
        title: t.title,
        protocol: t.protocol as 'ssh' | 'telnet' | 'rdp' | 'vnc',
        kind: t.kind,
        adHocHost: t.adHocHost
      }))
    });
  },

  saveSnippet: async (snippet) => {
    const { settings } = get();
    const exists = settings.snippets.some((s) => s.id === snippet.id);
    const snippets = exists
      ? settings.snippets.map((s) => (s.id === snippet.id ? snippet : s))
      : [...settings.snippets, snippet];
    await get().patchSettings({ snippets });
  },

  deleteSnippet: async (id) => {
    const { settings } = get();
    await get().patchSettings({ snippets: settings.snippets.filter((s) => s.id !== id) });
  }
}));

export function makeHost(partial: Partial<Host> & { name: string; host: string }): Host {
  return createHost({ ...partial, id: partial.id ?? nanoid(10), protocol: partial.protocol ?? 'ssh' });
}

export function makeGroup(name: string): Group {
  return createGroup({ name, id: nanoid(10) });
}
