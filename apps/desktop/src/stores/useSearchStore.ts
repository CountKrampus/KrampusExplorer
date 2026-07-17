import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useExplorerStore } from "./useExplorerStore";
import { useToastStore } from "./useToastStore";

/** Must match crates/search/src/query.rs's SEARCH_RESULT_CAP -- kept as a separate constant
 * because there's no shared-constant mechanism across the Rust/TS boundary in this codebase. */
export const SEARCH_RESULT_CAP = 500;

export interface SearchFilters {
  name: string;
  fileType: "file" | "folder" | "";
  /** Megabytes, as a controlled-input string; converted to bytes when a search runs. */
  minSize: string;
  maxSize: string;
  /** yyyy-mm-dd, as a controlled-input string; converted to a Unix timestamp when a search runs. */
  modifiedAfter: string;
  modifiedBefore: string;
}

export interface SearchResult {
  path: string;
  name: string;
  isDir: boolean;
  size: number | null;
  modified: number | null;
}

export interface HistoryEntry {
  root: string;
  query: string;
  searchedAt: number;
}

export interface SavedSearch {
  name: string;
  root: string;
  query: string | null;
  fileType: string | null;
  minSize: number | null;
  maxSize: number | null;
  modifiedAfter: number | null;
  modifiedBefore: number | null;
}

export const DEFAULT_FILTERS: SearchFilters = {
  name: "",
  fileType: "",
  minSize: "",
  maxSize: "",
  modifiedAfter: "",
  modifiedBefore: "",
};

interface BackendFilters {
  name: string | null;
  fileType: string | null;
  minSize: number | null;
  maxSize: number | null;
  modifiedAfter: number | null;
  modifiedBefore: number | null;
}

function toBytes(mb: string): number | null {
  return mb.trim() === "" ? null : Math.round(Number(mb) * 1024 * 1024);
}

function toEpochSeconds(dateStr: string): number | null {
  return dateStr.trim() === "" ? null : Math.floor(new Date(dateStr).getTime() / 1000);
}

function toBackendFilters(filters: SearchFilters): BackendFilters {
  return {
    name: filters.name.trim() === "" ? null : filters.name.trim(),
    fileType: filters.fileType === "" ? null : filters.fileType,
    minSize: toBytes(filters.minSize),
    maxSize: toBytes(filters.maxSize),
    modifiedAfter: toEpochSeconds(filters.modifiedAfter),
    modifiedBefore: toEpochSeconds(filters.modifiedBefore),
  };
}

function currentRoot(): string | null {
  const explorer = useExplorerStore.getState();
  const activeTab = explorer.tabs.find((tab) => tab.id === explorer.activeTabId);
  return activeTab ? activeTab.history[activeTab.historyIndex] : null;
}

interface SearchState {
  active: boolean;
  filters: SearchFilters;
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  history: HistoryEntry[];
  saved: SavedSearch[];
  setActive: (active: boolean) => void;
  setFilters: (filters: Partial<SearchFilters>) => void;
  runSearch: () => Promise<void>;
  loadHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
  loadSaved: () => Promise<void>;
  saveCurrentSearch: (name: string) => Promise<void>;
  deleteSaved: (name: string) => Promise<void>;
  runSavedSearch: (saved: SavedSearch) => Promise<void>;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  active: false,
  filters: DEFAULT_FILTERS,
  results: [],
  loading: false,
  error: null,
  history: [],
  saved: [],

  setActive: (active) => set({ active }),

  setFilters: (partial) => set((state) => ({ filters: { ...state.filters, ...partial } })),

  runSearch: async () => {
    const root = currentRoot();
    if (!root) return;
    set({ loading: true, error: null });
    try {
      const results = await invoke<SearchResult[]>("search_files", {
        root,
        filters: toBackendFilters(get().filters),
      });
      set({ results, loading: false });
      void get().loadHistory();
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  loadHistory: async () => {
    try {
      const history = await invoke<HistoryEntry[]>("get_search_history", { limit: 10 });
      set({ history });
    } catch {
      // Non-critical: history is a convenience list, not worth surfacing an error for.
    }
  },

  clearHistory: async () => {
    try {
      await invoke("clear_search_history");
      set({ history: [] });
    } catch (error) {
      useToastStore.getState().showToast(String(error));
    }
  },

  loadSaved: async () => {
    try {
      const saved = await invoke<SavedSearch[]>("list_saved_searches");
      set({ saved });
    } catch {
      // Non-critical, same reasoning as loadHistory.
    }
  },

  saveCurrentSearch: async (name) => {
    const root = currentRoot();
    if (!root) return;
    try {
      await invoke("save_search", { name, root, filters: toBackendFilters(get().filters) });
      void get().loadSaved();
    } catch (error) {
      useToastStore.getState().showToast(String(error));
    }
  },

  deleteSaved: async (name) => {
    try {
      await invoke("delete_saved_search", { name });
      void get().loadSaved();
    } catch (error) {
      useToastStore.getState().showToast(String(error));
    }
  },

  runSavedSearch: async (saved) => {
    const toMbString = (bytes: number | null) => (bytes === null ? "" : String(bytes / (1024 * 1024)));
    const toDateString = (epochSeconds: number | null) =>
      epochSeconds === null ? "" : new Date(epochSeconds * 1000).toISOString().slice(0, 10);

    set({
      active: true,
      filters: {
        name: saved.query ?? "",
        fileType: saved.fileType === "file" || saved.fileType === "folder" ? saved.fileType : "",
        minSize: toMbString(saved.minSize),
        maxSize: toMbString(saved.maxSize),
        modifiedAfter: toDateString(saved.modifiedAfter),
        modifiedBefore: toDateString(saved.modifiedBefore),
      },
    });
    await get().runSearch();
  },
}));
