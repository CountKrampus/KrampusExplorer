import { create } from "zustand";
import type { EntryInfo } from "../types/filesystem";

export interface Tab {
  id: string;
  history: string[];
  historyIndex: number;
  /** The parent of the tab's current path, as of the last completed fetch — not the in-flight one. Stale between navigateTo firing and setTabResult resolving. */
  parent: string | null;
  entries: EntryInfo[];
  loading: boolean;
  error: string | null;
  /** The "primary"/focused item — the one the preview pane shows and the plugin nav.read API
   * reports. Always the most recently interacted-with item: the last one added by a click,
   * toggle, or range-select. */
  selectedPath: string | null;
  /** The full multi-selection, in selection order (not display order). A plain click reduces
   * this to a single item; Ctrl+click toggles membership; Shift+click/Ctrl+A replace it with a
   * computed range/full set. */
  selectedPaths: string[];
  /** The fixed point Shift+click ranges are computed from. Set by plain and Ctrl+clicks; left
   * unchanged by Shift+click itself so repeated Shift+clicks adjust the range from the same
   * anchor, matching Explorer/Finder convention. */
  selectionAnchor: string | null;
}

type TabResult = { entries: EntryInfo[]; parent: string | null } | { error: string };

export interface Clipboard {
  paths: string[];
  mode: "copy" | "cut";
}

export interface PendingConflict {
  source: string;
  destDir: string;
  mode: "copy" | "move";
}

interface ExplorerState {
  tabs: Tab[];
  activeTabId: string;
  clipboard: Clipboard | null;
  pendingConflict: PendingConflict | null;
  navigateTo: (path: string) => void;
  back: () => void;
  forward: () => void;
  up: () => void;
  refresh: () => void;
  newTab: (path: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabResult: (id: string, result: TabResult) => void;
  setSelected: (path: string | null) => void;
  toggleSelected: (path: string) => void;
  selectRange: (paths: string[]) => void;
  selectAll: (paths: string[]) => void;
  clearSelection: () => void;
  setClipboard: (clipboard: Clipboard | null) => void;
  setPendingConflict: (conflict: PendingConflict | null) => void;
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
    selectedPath: null,
    selectedPaths: [],
    selectionAnchor: null,
  };
}

/** Resets a tab's selection — used everywhere navigation invalidates the current entry list. */
function clearedSelection() {
  return { selectedPath: null, selectedPaths: [], selectionAnchor: null };
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  tabs: [],
  activeTabId: "",
  clipboard: null,
  pendingConflict: null,

  navigateTo: (path) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId) return tab;
        const history = tab.history.slice(0, tab.historyIndex + 1);
        history.push(path);
        return {
          ...tab,
          history,
          historyIndex: history.length - 1,
          loading: true,
          error: null,
          ...clearedSelection(),
        };
      }),
    })),

  back: () =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId || tab.historyIndex <= 0) return tab;
        return {
          ...tab,
          historyIndex: tab.historyIndex - 1,
          loading: true,
          error: null,
          ...clearedSelection(),
        };
      }),
    })),

  forward: () =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId || tab.historyIndex >= tab.history.length - 1) return tab;
        return {
          ...tab,
          historyIndex: tab.historyIndex + 1,
          loading: true,
          error: null,
          ...clearedSelection(),
        };
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
      const closedIndex = state.tabs.findIndex((tab) => tab.id === id);
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const activeTabId =
        state.activeTabId === id
          ? tabs[Math.min(closedIndex, tabs.length - 1)].id
          : state.activeTabId;
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

  setSelected: (path) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId
          ? { ...tab, selectedPath: path, selectedPaths: path ? [path] : [], selectionAnchor: path }
          : tab,
      ),
    })),

  toggleSelected: (path) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId) return tab;
        const exists = tab.selectedPaths.includes(path);
        const selectedPaths = exists
          ? tab.selectedPaths.filter((p) => p !== path)
          : [...tab.selectedPaths, path];
        const selectedPath = selectedPaths.length > 0 ? selectedPaths[selectedPaths.length - 1] : null;
        return { ...tab, selectedPaths, selectedPath, selectionAnchor: path };
      }),
    })),

  // Anchor is deliberately left untouched — Shift+click computes a range from the existing
  // anchor without moving it, so repeated Shift+clicks adjust the same range.
  selectRange: (paths) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId
          ? { ...tab, selectedPaths: paths, selectedPath: paths.length > 0 ? paths[paths.length - 1] : null }
          : tab,
      ),
    })),

  selectAll: (paths) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId
          ? {
              ...tab,
              selectedPaths: paths,
              selectedPath: paths.length > 0 ? paths[paths.length - 1] : null,
              selectionAnchor: paths.length > 0 ? paths[0] : null,
            }
          : tab,
      ),
    })),

  clearSelection: () =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === state.activeTabId ? { ...tab, ...clearedSelection() } : tab)),
    })),

  setClipboard: (clipboard) => set({ clipboard }),

  setPendingConflict: (pendingConflict) => set({ pendingConflict }),
}));

export function useActiveTab(): Tab | undefined {
  return useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
}
