import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import "./TabBar.css";

export function tabLabel(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function TabBar() {
  const tabs = useExplorerStore((state) => state.tabs);
  const activeTabId = useExplorerStore((state) => state.activeTabId);
  const activeTab = useActiveTab();
  const setActiveTab = useExplorerStore((state) => state.setActiveTab);
  const closeTab = useExplorerStore((state) => state.closeTab);
  const newTab = useExplorerStore((state) => state.newTab);

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-bar__tab ${tab.id === activeTabId ? "tab-bar__tab--active" : ""}`}
          onClick={() => setActiveTab(tab.id)}
        >
          <span className="tab-bar__label">{tabLabel(tab.history[tab.historyIndex])}</span>
          {tabs.length > 1 && (
            <button
              className="tab-bar__close"
              aria-label="Close tab"
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
        onClick={() => newTab(activeTab ? activeTab.history[activeTab.historyIndex] : "")}
      >
        +
      </button>
    </div>
  );
}

export default TabBar;
