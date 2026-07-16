import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useExplorerStore } from "../stores/useExplorerStore";
import { useSearchStore } from "../stores/useSearchStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { usePluginStore } from "../stores/usePluginStore";
import { useToastStore } from "../stores/useToastStore";
import { performTransferBatch } from "../services/fileTransfer";
import { uniqueName } from "../utils/uniqueName";
import "./Toolbar.css";

function Toolbar() {
  // Individual primitive selectors (not the whole tab object) so this only re-renders when one
  // of these specific derived values actually changes — none of them depend on `selectedPath` or
  // `entries`, so a plain selection click no longer re-renders the toolbar.
  const hasActiveTab = useExplorerStore((state) => state.tabs.some((tab) => tab.id === state.activeTabId));
  const canGoBack = useExplorerStore((state) => {
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return !!tab && tab.historyIndex > 0;
  });
  const canGoForward = useExplorerStore((state) => {
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return !!tab && tab.historyIndex < tab.history.length - 1;
  });
  const canGoUp = useExplorerStore((state) => {
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return !!tab && !tab.loading && tab.parent !== null;
  });
  const tabBusy = useExplorerStore((state) => {
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return !tab || tab.loading || !!tab.error;
  });
  const currentPath = useExplorerStore((state) => {
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return tab ? tab.history[tab.historyIndex] : "";
  });
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

  const canCreate = hasActiveTab && !tabBusy && !creating;
  const canPaste = hasActiveTab && !tabBusy && !!clipboard && !pasting;

  async function paste() {
    if (!hasActiveTab || !clipboard || pasting) return;
    setPasting(true);
    const destDir = currentPath;
    try {
      await performTransferBatch(clipboard.paths, destDir, clipboard.mode === "cut" ? "move" : "copy");
    } finally {
      setPasting(false);
    }
  }

  async function createNew(kind: "folder" | "file") {
    const tab = useExplorerStore.getState().tabs.find((t) => t.id === useExplorerStore.getState().activeTabId);
    if (!tab || creating) return;
    setCreating(true);
    const parentPath = tab.history[tab.historyIndex];
    const existingNames = new Set(tab.entries.map((entry) => entry.name));
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
        disabled={!hasActiveTab}
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
      <span className="toolbar__path">{currentPath}</span>
    </div>
  );
}

export default Toolbar;
