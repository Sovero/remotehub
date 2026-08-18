import { create } from 'zustand';
import type { Settings, TreeNode } from '@shared/types';

let toastSeq = 0;

interface Toast {
  id: number;
  message: string;
}

interface AppState {
  tree: TreeNode[];
  settings: Settings;
  appInfo: { version: string; electron: string; platform: string } | null;
  ready: boolean;
  toasts: Toast[];
  init: () => Promise<void>;
  saveTree: (tree: TreeNode[]) => Promise<void>;
  patchSettings: (patch: Partial<Settings>) => Promise<void>;
  pushToast: (message: string) => void;
  dismissToast: (id: number) => void;
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
  }
}));
