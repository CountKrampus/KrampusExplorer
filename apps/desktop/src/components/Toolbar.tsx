import { invoke } from "@tauri-apps/api/core";
import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import "./Toolbar.css";

function uniqueName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) return baseName;
  let counter = 2;
  while (existingNames.has(`${baseName} (${counter})`)) counter++;
  return `${baseName} (${counter})`;
}

function Toolbar() {
  const activeTab = useActiveTab();
  const back = useExplorerStore((state) => state.back);
  const forward = useExplorerStore((state) => state.forward);
  const up = useExplorerStore((state) => state.up);
  const refresh = useExplorerStore((state) => state.refresh);
  const setSelected = useExplorerStore((state) => state.setSelected);

  const canGoBack = !!activeTab && activeTab.historyIndex > 0;
  const canGoForward = !!activeTab && activeTab.historyIndex < activeTab.history.length - 1;
  const canGoUp = !!activeTab && !activeTab.loading && activeTab.parent !== null;
  const canCreate = !!activeTab && !activeTab.loading && !activeTab.error;

  async function createNew(kind: "folder" | "file") {
    if (!activeTab) return;
    const parentPath = activeTab.history[activeTab.historyIndex];
    const existingNames = new Set(activeTab.entries.map((entry) => entry.name));
    const name = uniqueName(kind === "folder" ? "New folder" : "New file.txt", existingNames);
    const command = kind === "folder" ? "create_folder" : "create_file";
    try {
      const newPath = await invoke<string>(command, { parentPath, name });
      setSelected(newPath);
      refresh();
    } catch (error) {
      window.alert(String(error));
    }
  }

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
      <button disabled={!canCreate} onClick={() => createNew("folder")} aria-label="New folder">
        &#x1F4C1;+
      </button>
      <button disabled={!canCreate} onClick={() => createNew("file")} aria-label="New file">
        &#x1F4C4;+
      </button>
      <span className="toolbar__path">{activeTab?.history[activeTab.historyIndex] ?? ""}</span>
    </div>
  );
}

export default Toolbar;
