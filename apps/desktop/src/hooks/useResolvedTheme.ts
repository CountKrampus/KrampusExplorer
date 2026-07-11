import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/useSettingsStore";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useResolvedTheme(): "light" | "dark" {
  const theme = useSettingsStore((state) => state.theme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}
