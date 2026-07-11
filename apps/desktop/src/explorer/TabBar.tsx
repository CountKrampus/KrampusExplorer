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
      {tabs.map((tab, index) => {
        const label = tabLabel(tab.history[tab.historyIndex]);
        return (
          <div
            key={tab.id}
            id={`tab-bar__tab-${tab.id}`}
            className={`tab-bar__tab ${tab.id === activeTabId ? "tab-bar__tab--active" : ""}`}
            role="tab"
            tabIndex={0}
            aria-selected={tab.id === activeTabId}
            title={label}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            <span className="tab-bar__label">{label}</span>
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
        );
      })}
      <button
        className="tab-bar__new"
        aria-label="New tab"
        title="New tab"
        onClick={() => newTab(activeTab ? activeTab.history[activeTab.historyIndex] : "")}
      >
        +
      </button>
    </div>
  );
}

export default TabBar;
