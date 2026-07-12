import { useExplorerStore } from "../stores/useExplorerStore";
import "./StatusBar.css";

function StatusBar() {
  // A primitive selector (not the whole tab object) so this only re-renders when the item count
  // actually changes, not on every selection click or unrelated tab field update.
  const itemCount = useExplorerStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.entries.length ?? 0,
  );

  return (
    <div className="status-bar">
      <span>
        {itemCount} item{itemCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}

export default StatusBar;
