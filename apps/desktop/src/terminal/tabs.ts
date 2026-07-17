export interface TerminalTab {
  key: string;
  /** Shell executable to launch this tab with (e.g. "powershell.exe", "cmd.exe"), or null to
   * use the backend's auto-detected default shell. */
  shell: string | null;
}

export interface TerminalTabState {
  tabs: TerminalTab[];
  nextKey: number;
}

/** One tab to start, matching the "single window, multiple tabs" design — the terminal window
 * always opens with a shell ready to use, not an empty tab strip. Uses the auto-detected
 * default shell, same as before per-tab shell selection existed. */
export function initialTabs(): TerminalTabState {
  return { tabs: [{ key: "tab-1", shell: null }], nextKey: 2 };
}

/** Appends a new tab. `shell` requests a specific shell executable for this tab only (e.g. from
 * the "+ PS" / "+ CMD" buttons); omit it to use the backend's auto-detected default. */
export function addTab(state: TerminalTabState, shell: string | null = null): TerminalTabState {
  const key = `tab-${state.nextKey}`;
  return { tabs: [...state.tabs, { key, shell }], nextKey: state.nextKey + 1 };
}

export function removeTab(state: TerminalTabState, key: string): TerminalTabState {
  return { ...state, tabs: state.tabs.filter((tab) => tab.key !== key) };
}
