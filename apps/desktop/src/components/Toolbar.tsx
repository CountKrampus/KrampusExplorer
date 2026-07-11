import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import { useSearchStore } from "../stores/useSearchStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { usePluginStore } from "../stores/usePluginStore";
import { useToastStore } from "../stores/useToastStore";
import { performTransfer } from "../services/fileTransfer";
import { uniqueName } from "../utils/uniqueName";
import "./Toolbar.css";

function Toolbar() {
  const activeTab = useActiveTab();
  const back = useExplorerStore((state) => state.back);
  const forward = useExplorerStore((state) => state.forward);
  const up = useExplorerStore((state) => state.up);
  const refresh = useExplorerStore((state) => state.refresh);
  const setSelected = useExplorerStore((state) => state.setSelected);
  const clipboard = useExplorerStore((state) => state.clipboard);
  const searching = useSearchStore((state) => state.active);
  const setSearchActive = useSearchStore((state) => state.setActive);
  const setSettingsOpen = useSettingsStore((state) => state.setPanelOpen);
  const pluginToolbarButtons = usePluginStore((state) => state.toolbarButtons);
  const showToast = useToastStore((state) => state.showToast);

  // Guards against a fast double-click firing the same create/paste operation twice before the
  // first invoke resolves — the buttons below disable while their respective flag is set.
  const [creating, setCreating] = useState(false);
  const [pasting, setPasting] = useState(false);

  const canGoBack = !!activeTab && activeTab.historyIndex > 0;
  const canGoForward = !!activeTab && activeTab.historyIndex < activeTab.history.length - 1;
  const canGoUp = !!activeTab && !activeTab.loading && activeTab.parent !== null;
  const canCreate = !!activeTab && !activeTab.loading && !activeTab.error && !creating;
  const canPaste = !!activeTab && !activeTab.loading && !activeTab.error && !!clipboard && !pasting;

  async function paste() {
    if (!activeTab || !clipboard || pasting) return;
    setPasting(true);
    const destDir = activeTab.history[activeTab.historyIndex];
    try {
      await performTransfer(clipboard.path, destDir, clipboard.mode === "cut" ? "move" : "copy");
    } finally {
      setPasting(false);
    }
  }

  async function createNew(kind: "folder" | "file") {
    if (!activeTab || creating) return;
    setCreating(true);
    const parentPath = activeTab.history[activeTab.historyIndex];
    const existingNames = new Set(activeTab.entries.map((entry) => entry.name));
    const name = uniqueName(kind === "folder" ? "New folder" : "New file.txt", existingNames);
    const command = kind === "folder" ? "create_folder" : "create_file";
    try {
      const newPath = await invoke<string>(command, { parentPath, name });
      setSelected(newPath);
      refresh();
    } catch (error) {
      showToast(String(error));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="toolbar">
      <button disabled={!canGoBack} onClick={back} aria-label="Back" title="Back">
        &#x2190;
      </button>
      <button disabled={!canGoForward} onClick={forward} aria-label="Forward" title="Forward">
        &#x2192;
      </button>
      <button disabled={!canGoUp} onClick={up} aria-label="Up" title="Up one level">
        &#x2191;
      </button>
      <button onClick={refresh} aria-label="Refresh" title="Refresh">
        &#x21bb;
      </button>
      <button
        disabled={!canCreate}
        onClick={() => void createNew("folder")}
        aria-label="New folder"
        title="New folder"
      >
        &#x1F4C1;+
      </button>
      <button
        disabled={!canCreate}
        onClick={() => void createNew("file")}
        aria-label="New file"
        title="New file"
      >
        &#x1F4C4;+
      </button>
      <button disabled={!canPaste} onClick={() => void paste()} aria-label="Paste" title="Paste">
        &#x1F4CB;
      </button>
      <button
        disabled={!activeTab}
        onClick={() => setSearchActive(!searching)}
        aria-label="Search"
        aria-pressed={searching}
        title="Search"
      >
        &#x1F50D;
      </button>
      <button onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
        &#x2699;
      </button>
      {pluginToolbarButtons.length > 0 && <span className="toolbar__separator" aria-hidden="true" />}
      {pluginToolbarButtons.map((button) => (
        <button
          key={`${button.pluginId}:${button.id}`}
          onClick={button.onClick}
          aria-label={button.label}
          title={button.label}
        >
          {button.label}
        </button>
      ))}
      <span className="toolbar__path">{activeTab?.history[activeTab.historyIndex] ?? ""}</span>
    </div>
  );
}

export default Toolbar;
