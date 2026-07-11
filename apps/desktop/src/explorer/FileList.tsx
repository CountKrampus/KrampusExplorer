import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import "./FileList.css";

export function formatSize(size: number | null): string {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatModified(modified: string | null): string {
  if (modified === null) return "";
  const seconds = Number(modified);
  if (Number.isNaN(seconds)) return "";
  return new Date(seconds * 1000).toLocaleString();
}

interface ContextMenuState {
  path: string;
  x: number;
  y: number;
}

function FileList() {
  const activeTab = useActiveTab();
  const navigateTo = useExplorerStore((state) => state.navigateTo);
  const refresh = useExplorerStore((state) => state.refresh);
  const setSelected = useExplorerStore((state) => state.setSelected);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const selectedPath = activeTab?.selectedPath ?? null;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  useEffect(() => {
    if (renamingPath) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingPath]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (renamingPath || !selectedPath) return;
      if (event.key === "Delete") {
        void handleDelete(selectedPath);
      } else if (event.key === "F2") {
        beginRename(selectedPath);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, renamingPath]);

  if (!activeTab) return null;
  const tab = activeTab;

  function beginRename(path: string) {
    const entry = tab.entries.find((e) => e.path === path);
    if (!entry) return;
    setRenamingPath(path);
    setRenameValue(entry.name);
    setMenu(null);
  }

  async function commitRename(path: string) {
    const name = renameValue.trim();
    setRenamingPath(null);
    const entry = tab.entries.find((e) => e.path === path);
    if (!entry || !name || name === entry.name) return;
    try {
      const newPath = await invoke<string>("rename_entry", { path, newName: name });
      setSelected(newPath);
      refresh();
    } catch (error) {
      window.alert(String(error));
    }
  }

  async function handleDelete(path: string) {
    if (!window.confirm("Move this item to the Recycle Bin?")) return;
    try {
      await invoke("delete_entry", { path });
      setSelected(null);
      refresh();
    } catch (error) {
      window.alert(String(error));
    }
  }

  if (activeTab.error) {
    return (
      <div className="file-list-message file-list-message--error">
        <p>{activeTab.error}</p>
        <button onClick={refresh}>Retry</button>
      </div>
    );
  }

  if (activeTab.loading) {
    return <div className="file-list-message">Loading…</div>;
  }

  if (activeTab.entries.length === 0) {
    return <div className="file-list-message">This folder is empty.</div>;
  }

  return (
    <>
      <table className="file-list">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Size</th>
            <th scope="col">Modified</th>
          </tr>
        </thead>
        <tbody>
          {activeTab.entries.map((entry) => (
            <tr
              key={entry.path}
              className={
                entry.path === selectedPath
                  ? "file-list__row file-list__row--selected"
                  : "file-list__row"
              }
              onClick={() => setSelected(entry.path)}
              onDoubleClick={() => entry.isDir && navigateTo(entry.path)}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelected(entry.path);
                setMenu({ path: entry.path, x: event.clientX, y: event.clientY });
              }}
            >
              <td>
                {entry.isDir ? "\u{1F4C1} " : "\u{1F4C4} "}
                {renamingPath === entry.path ? (
                  <input
                    ref={renameInputRef}
                    className="file-list__rename-input"
                    value={renameValue}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => commitRename(entry.path)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRename(entry.path);
                      if (event.key === "Escape") setRenamingPath(null);
                    }}
                  />
                ) : (
                  entry.name
                )}
              </td>
              <td>{formatSize(entry.size)}</td>
              <td>{formatModified(entry.modified)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {menu && (
        <div
          className="file-list__context-menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button onClick={() => beginRename(menu.path)}>Rename</button>
          <button
            onClick={() => {
              setMenu(null);
              void handleDelete(menu.path);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </>
  );
}

export default FileList;
