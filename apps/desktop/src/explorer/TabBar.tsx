import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useExplorerStore } from "../stores/useExplorerStore";
import "./TabBar.css";

export function tabLabel(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

interface TabSummary {
  id: string;
  label: string;
}

// A plain space is fine here even though filenames commonly contain spaces — `tab.id` (format
// `tab-<n>`) never does, so splitting off the first token as the id and rejoining every
// remaining token as the label (below) is unambiguous regardless of what's in the label.
const KEY_SEPARATOR = " ";

/** `useShallow`'s array comparison checks each element by reference (`Object.is`) — it does NOT
 * recursively compare object fields. Mapping tabs straight to `{ id, label }` object literals
 * inside the selector means every call mints brand-new objects, so the array can never compare
 * as "unchanged" even when nothing meaningful changed, which starves React's render loop
 * (`Maximum update depth exceeded`). Selecting primitive strings instead works correctly, since
 * JS string primitives compare by value; the `{ id, label }` objects are then derived via a
 * separate `useMemo` keyed on those stable strings. */
function TabBar() {
  const tabKeys = useExplorerStore(
    useShallow((state): string[] =>
      state.tabs.map((tab) => `${tab.id}${KEY_SEPARATOR}${tabLabel(tab.history[tab.historyIndex])}`),
    ),
  );
  const tabs = useMemo<TabSummary[]>(
    () =>
      tabKeys.map((key) => {
        const [id, ...labelParts] = key.split(KEY_SEPARATOR);
        return { id, label: labelParts.join(KEY_SEPARATOR) };
      }),
    [tabKeys],
  );
  const activeTabId = useExplorerStore((state) => state.activeTabId);
  const setActiveTab = useExplorerStore((state) => state.setActiveTab);
  const closeTab = useExplorerStore((state) => state.closeTab);
  const newTab = useExplorerStore((state) => state.newTab);

  function focusTabAt(index: number) {
    const el = document.getElementById(`tab-bar__tab-${tabs[index]?.id}`);
    el?.focus();
  }

  function handleTabKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActiveTab(tabs[index].id);
    } else if (event.key === "ArrowRight" && index < tabs.length - 1) {
      event.preventDefault();
      setActiveTab(tabs[index + 1].id);
      focusTabAt(index + 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      setActiveTab(tabs[index - 1].id);
      focusTabAt(index - 1);
    }
  }

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          id={`tab-bar__tab-${tab.id}`}
          className={`tab-bar__tab ${tab.id === activeTabId ? "tab-bar__tab--active" : ""}`}
          role="tab"
          tabIndex={0}
          aria-selected={tab.id === activeTabId}
          title={tab.label}
          onClick={() => setActiveTab(tab.id)}
          onKeyDown={(event) => handleTabKeyDown(event, index)}
        >
          <span className="tab-bar__label">{tab.label}</span>
          {tabs.length > 1 && (
            <button
              className="tab-bar__close"
              aria-label="Close tab"
              title="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
            >
              &#x2715;
            </button>
          )}
        </div>
      ))}
      <button
        className="tab-bar__new"
        aria-label="New tab"
        title="New tab"
        onClick={() => {
          const state = useExplorerStore.getState();
          const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
          newTab(activeTab ? activeTab.history[activeTab.historyIndex] : "");
        }}
      >
        +
      </button>
    </div>
  );
}

export default TabBar;
