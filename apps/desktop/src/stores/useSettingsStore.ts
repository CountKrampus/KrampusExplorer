import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type Theme = "light" | "dark" | "system";
export type StartupMode = "home" | "custom";
export type IconSize = "small" | "medium" | "large";

interface BackendSettings {
  theme: string;
  accentColor: string;
  startupMode: string;
  startupCustomPath: string | null;
  iconSize: string;
}

const DEFAULTS: BackendSettings = {
  theme: "system",
  accentColor: "#2b6cb0",
  startupMode: "home",
  startupCustomPath: null,
  iconSize: "medium",
};

function asTheme(value: string): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

function asStartupMode(value: string): StartupMode {
  return value === "custom" ? "custom" : "home";
}

function asIconSize(value: string): IconSize {
  return value === "small" || value === "large" ? value : "medium";
}

interface SettingsState {
  loaded: boolean;
  theme: Theme;
  accentColor: string;
  startupMode: StartupMode;
  startupCustomPath: string | null;
  iconSize: IconSize;
  panelOpen: boolean;
  loadSettings: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setAccentColor: (color: string) => void;
  setStartupMode: (mode: StartupMode) => void;
  setStartupCustomPath: (path: string | null) => void;
  setIconSize: (size: IconSize) => void;
  setPanelOpen: (open: boolean) => void;
}

function persist(state: SettingsState) {
  const payload: BackendSettings = {
    theme: state.theme,
    accentColor: state.accentColor,
    startupMode: state.startupMode,
    startupCustomPath: state.startupCustomPath,
    iconSize: state.iconSize,
  };
  invoke("save_settings", { settings: payload }).catch((error: string) => {
    window.alert(`Could not save settings: ${error}`);
  });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  loaded: false,
  theme: asTheme(DEFAULTS.theme),
  accentColor: DEFAULTS.accentColor,
  startupMode: asStartupMode(DEFAULTS.startupMode),
  startupCustomPath: DEFAULTS.startupCustomPath,
  iconSize: asIconSize(DEFAULTS.iconSize),
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

  setPanelOpen: (panelOpen) => set({ panelOpen }),
}));
