export interface TerminalTabState {
  tabs: string[];
  nextKey: number;
}

/** One tab to start, matching the "single window, multiple tabs" design — the terminal window
 * always opens with a shell ready to use, not an empty tab strip. */
export function initialTabs(): TerminalTabState {
  return { tabs: ["tab-1"], nextKey: 2 };
}

export function addTab(state: TerminalTabState): TerminalTabState {
  const key = `tab-${state.nextKey}`;
  return { tabs: [...state.tabs, key], nextKey: state.nextKey + 1 };
}

export function removeTab(state: TerminalTabState, key: string): TerminalTabState {
  return { ...state, tabs: state.tabs.filter((existing) => existing !== key) };
}
