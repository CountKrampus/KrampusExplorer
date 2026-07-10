import { create } from "zustand";
import type { EntryInfo } from "../types/filesystem";

export interface Tab {
  id: string;
  history: string[];
  historyIndex: number;
  parent: string | null;
  entries: EntryInfo[];
  loading: boolean;
  error: string | null;
}

type TabResult = { entries: EntryInfo[]; parent: string | null } | { error: string };

interface ExplorerState {
  tabs: Tab[];
  activeTabId: string;
  navigateTo: (path: string) => void;
  back: () => void;
  forward: () => void;
  up: () => void;
  refresh: () => void;
  newTab: (path: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabResult: (id: string, result: TabResult) => void;
}

let nextTabId = 1;

function createTab(path: string): Tab {
  return {
    id: `tab-${nextTabId++}`,
    history: [path],
    historyIndex: 0,
    parent: null,
    entries: [],
    loading: true,
    error: null,
  };
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  tabs: [],
  activeTabId: "",

  navigateTo: (path) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId) return tab;
        const history = tab.history.slice(0, tab.historyIndex + 1);
        history.push(path);
        return { ...tab, history, historyIndex: history.length - 1, loading: true, error: null };
      }),
    })),

  back: () =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId || tab.historyIndex <= 0) return tab;
        return { ...tab, historyIndex: tab.historyIndex - 1, loading: true, error: null };
      }),
    })),

  forward: () =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId || tab.historyIndex >= tab.history.length - 1) return tab;
        return { ...tab, historyIndex: tab.historyIndex + 1, loading: true, error: null };
      }),
    })),

  up: () => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    if (!tab || tab.parent === null) return;
    get().navigateTo(tab.parent);
  },

  refresh: () =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId ? { ...tab, loading: true, error: null } : tab,
      ),
    })),

  newTab: (path) =>
    set((state) => {
      const tab = createTab(path);
      return { tabs: [...state.tabs, tab], activeTabId: tab.id };
    }),

  closeTab: (id) =>
    set((state) => {
      if (state.tabs.length <= 1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const activeTabId = state.activeTabId === id ? tabs[tabs.length - 1].id : state.activeTabId;
      return { tabs, activeTabId };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  setTabResult: (id, result) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== id) return tab;
        if ("error" in result) {
          return { ...tab, loading: false, error: result.error };
        }
        return { ...tab, loading: false, error: null, entries: result.entries, parent: result.parent };
      }),
    })),
}));

export function useActiveTab(): Tab | undefined {
  return useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
}
