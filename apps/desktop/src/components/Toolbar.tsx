import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import "./Toolbar.css";

function Toolbar() {
  const activeTab = useActiveTab();
  const back = useExplorerStore((state) => state.back);
  const forward = useExplorerStore((state) => state.forward);
  const up = useExplorerStore((state) => state.up);
  const refresh = useExplorerStore((state) => state.refresh);

  const canGoBack = !!activeTab && activeTab.historyIndex > 0;
  const canGoForward = !!activeTab && activeTab.historyIndex < activeTab.history.length - 1;
  const canGoUp = !!activeTab && activeTab.parent !== null;

  return (
    <div className="toolbar">
      <button disabled={!canGoBack} onClick={back} aria-label="Back">
        &#x2190;
      </button>
      <button disabled={!canGoForward} onClick={forward} aria-label="Forward">
        &#x2192;
      </button>
      <button disabled={!canGoUp} onClick={up} aria-label="Up">
        &#x2191;
      </button>
      <button onClick={refresh} aria-label="Refresh">
        &#x21bb;
      </button>
      <span className="toolbar__path">{activeTab?.history[activeTab.historyIndex] ?? ""}</span>
    </div>
  );
}

export default Toolbar;
