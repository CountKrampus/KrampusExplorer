import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { performTransfer } from "../services/fileTransfer";
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
  const clipboard = useExplorerStore((state) => state.clipboard);
  const setClipboard = useExplorerStore((state) => state.setClipboard);
  const iconSize = useSettingsStore((state) => state.iconSize);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const draggingPathRef = useRef<string | null>(null);

  const selectedPath = activeTab?.selectedPath ?? null;
  const currentPath = activeTab?.history[activeTab.historyIndex] ?? null;

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
      if (renamingPath) return;
      const isModified = event.ctrlKey || event.metaKey;

      if (isModified && event.key.toLowerCase() === "v") {
        if (clipboard && currentPath) {
          void performTransfer(clipboard.path, currentPath, clipboard.mode === "cut" ? "move" : "copy");
        }
        return;
      }
      if (!selectedPath) return;
      if (isModified && event.key.toLowerCase() === "c") {
        setClipboard({ path: selectedPath, mode: "copy" });
      } else if (isModified && event.key.toLowerCase() === "x") {
        setClipboard({ path: selectedPath, mode: "cut" });
      } else if (event.key === "Delete") {
        void handleDelete(selectedPath);
      } else if (event.key === "F2") {
        beginRename(selectedPath);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, renamingPath, clipboard, currentPath]);

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

  function handleDrop(event: React.DragEvent, destDir: string) {
    event.preventDefault();
    setDragOverPath(null);
    const sourcePath = draggingPathRef.current;
    draggingPathRef.current = null;
    if (!sourcePath || sourcePath === destDir) return;
    void performTransfer(sourcePath, destDir, event.ctrlKey ? "copy" : "move");
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
      <table className={`file-list file-list--icon-${iconSize}`}>
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
              className={[
                "file-list__row",
                entry.path === selectedPath ? "file-list__row--selected" : "",
                entry.path === dragOverPath ? "file-list__row--drag-over" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable
              onClick={() => setSelected(entry.path)}
              onDoubleClick={() => entry.isDir && navigateTo(entry.path)}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelected(entry.path);
                setMenu({ path: entry.path, x: event.clientX, y: event.clientY });
              }}
              onDragStart={(event) => {
                draggingPathRef.current = entry.path;
                event.dataTransfer.effectAllowed = "copyMove";
                event.dataTransfer.setData("text/plain", entry.path);
              }}
              onDragEnd={() => {
                draggingPathRef.current = null;
                setDragOverPath(null);
              }}
              onDragOver={(event) => {
                if (!entry.isDir || draggingPathRef.current === entry.path) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
              }}
              onDragEnter={(event) => {
                if (!entry.isDir || draggingPathRef.current === entry.path) return;
                event.preventDefault();
                setDragOverPath(entry.path);
              }}
              onDragLeave={() => setDragOverPath((current) => (current === entry.path ? null : current))}
              onDrop={(event) => entry.isDir && handleDrop(event, entry.path)}
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
          <button
            onClick={() => {
              setClipboard({ path: menu.path, mode: "copy" });
              setMenu(null);
            }}
          >
            Copy
          </button>
          <button
            onClick={() => {
              setClipboard({ path: menu.path, mode: "cut" });
              setMenu(null);
            }}
          >
            Cut
          </button>
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
