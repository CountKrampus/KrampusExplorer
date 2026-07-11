import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

interface StoredTheme {
  theme: Theme;
  accentColor: string;
}

interface ThemeState extends StoredTheme {
  setTheme: (theme: Theme) => void;
  setAccentColor: (color: string) => void;
}

const STORAGE_KEY = "krampus-explorer:theme";
const DEFAULTS: StoredTheme = { theme: "system", accentColor: "#2b6cb0" };

function loadStoredTheme(): StoredTheme {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTheme>;
    const theme =
      parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system"
        ? parsed.theme
        : DEFAULTS.theme;
    return {
      theme,
      accentColor: parsed.accentColor ?? DEFAULTS.accentColor,
    };
  } catch (err) {
    console.warn("Failed to parse stored theme, using defaults", err);
    return DEFAULTS;
  }
}

function persist(state: StoredTheme) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  ...loadStoredTheme(),

  setTheme: (theme) => {
    set({ theme });
    persist({ theme, accentColor: get().accentColor });
  },

  setAccentColor: (accentColor) => {
    set({ accentColor });
    persist({ theme: get().theme, accentColor });
  },
}));
