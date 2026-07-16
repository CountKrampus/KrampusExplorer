import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type Theme = "light" | "dark" | "system";
export type StartupMode = "home" | "custom" | "last";
export type IconSize = "small" | "medium" | "large";
export type SortField = "name" | "size" | "type" | "modified" | "created";
export type SortDirection = "asc" | "desc";

const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 480;

interface BackendSettings {
  theme: string;
  accentColor: string;
  startupMode: string;
  startupCustomPath: string | null;
  iconSize: string;
  lastLocation: string | null;
  disabledPlugins: string[];
  favoritePaths: string[];
  collapsedSidebarSections: string[];
  sidebarWidth: number;
  sortField: string;
  sortDirection: string;
  activePluginPanel: string | null;
}

const DEFAULTS: BackendSettings = {
  theme: "system",
  accentColor: "#2b6cb0",
  startupMode: "home",
  startupCustomPath: null,
  iconSize: "medium",
  lastLocation: null,
  disabledPlugins: [],
  favoritePaths: [],
  collapsedSidebarSections: [],
  sidebarWidth: 200,
  sortField: "name",
  sortDirection: "asc",
  activePluginPanel: null,
};

function asTheme(value: string): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

function asStartupMode(value: string): StartupMode {
  return value === "custom" || value === "last" ? value : "home";
}

function asIconSize(value: string): IconSize {
  return value === "small" || value === "large" ? value : "medium";
}

function asSortField(value: string): SortField {
  return value === "size" || value === "type" || value === "modified" || value === "created"
    ? value
    : "name";
}

function asSortDirection(value: string): SortDirection {
  return value === "desc" ? "desc" : "asc";
}

interface SettingsState {
  loaded: boolean;
  theme: Theme;
  accentColor: string;
  startupMode: StartupMode;
  startupCustomPath: string | null;
  iconSize: IconSize;
  lastLocation: string | null;
  disabledPlugins: string[];
  favoritePaths: string[];
  collapsedSidebarSections: string[];
  sidebarWidth: number;
  sortField: SortField;
  sortDirection: SortDirection;
  activePluginPanel: string | null;
  panelOpen: boolean;
  loadSettings: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setAccentColor: (color: string) => void;
  setStartupMode: (mode: StartupMode) => void;
  setStartupCustomPath: (path: string | null) => void;
  setIconSize: (size: IconSize) => void;
  setLastLocation: (path: string) => void;
  setPluginEnabled: (pluginId: string, enabled: boolean) => void;
  addFavorite: (path: string) => void;
  removeFavorite: (path: string) => void;
  toggleSidebarSection: (sectionId: string) => void;
  setSidebarWidth: (width: number) => void;
  setSort: (field: SortField) => void;
  setActivePluginPanel: (key: string | null) => void;
  setPanelOpen: (open: boolean) => void;
}

// Failures here are logged, not surfaced with an alert — setLastLocation fires on every
// folder navigation, so a transient write failure alerting the user on every click would be
// far more disruptive than the failure itself (the setting just won't have updated).
function persist(state: SettingsState) {
  const payload: BackendSettings = {
    theme: state.theme,
    accentColor: state.accentColor,
    startupMode: state.startupMode,
    startupCustomPath: state.startupCustomPath,
    iconSize: state.iconSize,
    lastLocation: state.lastLocation,
    disabledPlugins: state.disabledPlugins,
    favoritePaths: state.favoritePaths,
    collapsedSidebarSections: state.collapsedSidebarSections,
    sidebarWidth: state.sidebarWidth,
    sortField: state.sortField,
    sortDirection: state.sortDirection,
    activePluginPanel: state.activePluginPanel,
  };
  invoke("save_settings", { settings: payload }).catch((error: string) => {
    console.error("Could not save settings:", error);
  });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  loaded: false,
  theme: asTheme(DEFAULTS.theme),
  accentColor: DEFAULTS.accentColor,
  startupMode: asStartupMode(DEFAULTS.startupMode),
  startupCustomPath: DEFAULTS.startupCustomPath,
  iconSize: asIconSize(DEFAULTS.iconSize),
  lastLocation: DEFAULTS.lastLocation,
  disabledPlugins: DEFAULTS.disabledPlugins,
  favoritePaths: DEFAULTS.favoritePaths,
  collapsedSidebarSections: DEFAULTS.collapsedSidebarSections,
  sidebarWidth: DEFAULTS.sidebarWidth,
  sortField: asSortField(DEFAULTS.sortField),
  sortDirection: asSortDirection(DEFAULTS.sortDirection),
  activePluginPanel: DEFAULTS.activePluginPanel,
  panelOpen: false,

  loadSettings: async () => {
    try {
      const settings = await invoke<BackendSettings>("get_settings");
      set({
        theme: asTheme(settings.theme),
        accentColor: settings.accentColor,
        startupMode: asStartupMode(settings.startupMode),
        startupCustomPath: settings.startupCustomPath,
        iconSize: asIconSize(settings.iconSize),
        lastLocation: settings.lastLocation,
        disabledPlugins: settings.disabledPlugins,
        favoritePaths: settings.favoritePaths,
        collapsedSidebarSections: settings.collapsedSidebarSections,
        sidebarWidth: settings.sidebarWidth,
        sortField: asSortField(settings.sortField),
        sortDirection: asSortDirection(settings.sortDirection),
        activePluginPanel: settings.activePluginPanel,
        loaded: true,
      });
    } catch {
      // Backend already falls back to defaults internally; a failure here means the IPC
      // call itself failed, so just proceed with the in-memory defaults already set.
      set({ loaded: true });
    }
  },

  setTheme: (theme) => {
    set({ theme });
    persist(get());
  },

  setAccentColor: (accentColor) => {
    set({ accentColor });
    persist(get());
  },

  setStartupMode: (startupMode) => {
    set({ startupMode });
    persist(get());
  },

  setStartupCustomPath: (startupCustomPath) => {
    set({ startupCustomPath });
    persist(get());
  },

  setIconSize: (iconSize) => {
    set({ iconSize });
    persist(get());
  },

  setLastLocation: (lastLocation) => {
    if (get().lastLocation === lastLocation) return;
    set({ lastLocation });
    persist(get());
  },

  setPluginEnabled: (pluginId, enabled) => {
    const current = get().disabledPlugins;
    const disabledPlugins = enabled
      ? current.filter((id) => id !== pluginId)
      : current.includes(pluginId)
        ? current
        : [...current, pluginId];
    set({ disabledPlugins });
    persist(get());
  },

  addFavorite: (path) => {
    const current = get().favoritePaths;
    if (current.includes(path)) return;
    set({ favoritePaths: [...current, path] });
    persist(get());
  },

  removeFavorite: (path) => {
    set({ favoritePaths: get().favoritePaths.filter((p) => p !== path) });
    persist(get());
  },

  toggleSidebarSection: (sectionId) => {
    const current = get().collapsedSidebarSections;
    const collapsedSidebarSections = current.includes(sectionId)
      ? current.filter((id) => id !== sectionId)
      : [...current, sectionId];
    set({ collapsedSidebarSections });
    persist(get());
  },

  setSidebarWidth: (width) => {
    const clamped = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
    set({ sidebarWidth: clamped });
    persist(get());
  },

  setSort: (field) => {
    const { sortField, sortDirection } = get();
    if (field === sortField) {
      set({ sortDirection: sortDirection === "asc" ? "desc" : "asc" });
    } else {
      set({ sortField: field, sortDirection: "asc" });
    }
    persist(get());
  },

  setActivePluginPanel: (activePluginPanel) => {
    set({ activePluginPanel });
    persist(get());
  },

  setPanelOpen: (panelOpen) => set({ panelOpen }),
}));
