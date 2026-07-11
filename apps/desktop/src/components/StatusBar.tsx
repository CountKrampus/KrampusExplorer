import { useActiveTab } from "../stores/useExplorerStore";
import "./StatusBar.css";

function StatusBar() {
  const activeTab = useActiveTab();
  const itemCount = activeTab?.entries.length ?? 0;

  return (
    <div className="status-bar">
      <span>
        {itemCount} item{itemCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}

export default StatusBar;
