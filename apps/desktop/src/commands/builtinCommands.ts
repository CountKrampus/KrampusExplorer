import { useExplorerStore } from "../stores/useExplorerStore";
import { useSearchStore } from "../stores/useSearchStore";
import { useSettingsStore, type Theme } from "../stores/useSettingsStore";

export interface BuiltinCommand {
  id: string;
  label: string;
  run: () => void;
}

const THEME_CYCLE: Theme[] = ["light", "dark", "system"];

/** Commands available even with zero plugins installed — an empty command palette isn't useful
 * on its own, so the core app contributes a baseline set covering the actions already reachable
 * via the toolbar/keyboard shortcuts, just discoverable by name instead. */
export const builtinCommands: BuiltinCommand[] = [
  {
    id: "core.new-tab",
    label: "New Tab",
    run: () => {
      const state = useExplorerStore.getState();
      const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
      state.newTab(activeTab ? activeTab.history[activeTab.historyIndex] : "");
    },
  },
  { id: "core.go-back", label: "Go Back", run: () => useExplorerStore.getState().back() },
  { id: "core.go-forward", label: "Go Forward", run: () => useExplorerStore.getState().forward() },
  { id: "core.go-up", label: "Go Up One Level", run: () => useExplorerStore.getState().up() },
  { id: "core.refresh", label: "Refresh", run: () => useExplorerStore.getState().refresh() },
  {
    id: "core.toggle-search",
    label: "Toggle Search",
    run: () => {
      const state = useSearchStore.getState();
      state.setActive(!state.active);
    },
  },
  {
    id: "core.open-settings",
    label: "Open Settings",
    run: () => useSettingsStore.getState().setPanelOpen(true),
  },
  {
    id: "core.cycle-theme",
    label: "Cycle Theme (Light/Dark/System)",
    run: () => {
      const state = useSettingsStore.getState();
      const next = THEME_CYCLE[(THEME_CYCLE.indexOf(state.theme) + 1) % THEME_CYCLE.length];
      state.setTheme(next);
    },
  },
];
