import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import { useSettingsStore, type SortDirection, type SortField } from "../stores/useSettingsStore";
import { usePluginStore } from "../stores/usePluginStore";
import { useToastStore } from "../stores/useToastStore";
import { performTransfer } from "../services/fileTransfer";
import ConfirmDialog from "../components/ConfirmDialog";
import type { EntryInfo } from "../types/filesystem";
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

function extensionOf(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex <= 0 ? "" : name.slice(dotIndex + 1).toLowerCase();
}

/** Folders always sort before files regardless of `field` — sorting folders by "size" or
 * "type" is meaningless since folders don't carry a size or extension in this app. */
export function sortEntries(entries: EntryInfo[], field: SortField, direction: SortDirection): EntryInfo[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (field === "name") {
      return sign * a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    }
    if (field === "size") {
      return sign * ((a.size ?? 0) - (b.size ?? 0));
    }
    if (field === "type") {
      return sign * extensionOf(a.name).localeCompare(extensionOf(b.name));
    }
    if (field === "created") {
      const aTime = a.created ? Number(a.created) : 0;
      const bTime = b.created ? Number(b.created) : 0;
      return sign * (aTime - bTime);
    }
    // modified
    const aTime = a.modified ? Number(a.modified) : 0;
    const bTime = b.modified ? Number(b.modified) : 0;
    return sign * (aTime - bTime);
  });
}

interface ContextMenuState {
  path: string;
  isDir: boolean;
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
  const favoritePaths = useSettingsStore((state) => state.favoritePaths);
  const addFavorite = useSettingsStore((state) => state.addFavorite);
  const removeFavorite = useSettingsStore((state) => state.removeFavorite);
  const sortField = useSettingsStore((state) => state.sortField);
  const sortDirection = useSettingsStore((state) => state.sortDirection);
  const setSort = useSettingsStore((state) => state.setSort);
  const contextMenuItems = usePluginStore((state) => state.contextMenuItems);
  const showToast = useToastStore((state) => state.showToast);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const draggingPathRef = useRef<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  // Guards against a rename committing twice: pressing Enter unmounts the rename <input> on the
  // next render, which fires a native blur that would otherwise re-invoke commitRename a second
  // time with the same value.
  const commitInFlightRef = useRef(false);
  const suppressNextBlurRef = useRef(false);

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
        setPendingDeletePath(selectedPath);
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
  const sortedEntries = sortEntries(tab.entries, sortField, sortDirection);

  function beginRename(path: string) {
    const entry = tab.entries.find((e) => e.path === path);
    if (!entry) return;
    setRenamingPath(path);
    setRenameValue(entry.name);
    setMenu(null);
  }

  async function commitRename(path: string) {
    if (commitInFlightRef.current) return;
    commitInFlightRef.current = true;
    setRenamingPath(null);
    try {
      const name = renameValue.trim();
      const entry = tab.entries.find((e) => e.path === path);
      if (!entry || !name || name === entry.name) return;
      try {
        const newPath = await invoke<string>("rename_entry", { path, newName: name });
        setSelected(newPath);
        refresh();
      } catch (error) {
        showToast(String(error));
      }
    } finally {
      commitInFlightRef.current = false;
    }
  }

  function cancelRename() {
    suppressNextBlurRef.current = true;
    setRenamingPath(null);
  }

  async function handleDelete(path: string) {
    try {
      await invoke("delete_entry", { path });
      setSelected(null);
      refresh();
    } catch (error) {
      showToast(String(error));
    }
  }

  function focusRow(path: string) {
    rowRefs.current.get(path)?.focus();
  }

  function handleRowKeyDown(event: React.KeyboardEvent, index: number) {
    const entries = sortedEntries;
    if (event.key === "ArrowDown" && index < entries.length - 1) {
      event.preventDefault();
      const next = entries[index + 1];
      setSelected(next.path);
      focusRow(next.path);
    } else if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      const previous = entries[index - 1];
      setSelected(previous.path);
      focusRow(previous.path);
    } else if (event.key === "Enter") {
      const entry = entries[index];
      if (entry.isDir) {
        event.preventDefault();
        navigateTo(entry.path);
      }
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
      <div className="file-list__toolbar">
        <label className="file-list__sort-dropdown">
          Sort by:{" "}
          <select value={sortField} onChange={(event) => setSort(event.target.value as SortField)}>
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="type">Type</option>
            <option value="modified">Date Modified</option>
            <option value="created">Date Created</option>
          </select>
        </label>
        <button
          type="button"
          className="file-list__sort-direction"
          onClick={() => setSort(sortField)}
          aria-label={sortDirection === "asc" ? "Sort ascending" : "Sort descending"}
          title={sortDirection === "asc" ? "Ascending" : "Descending"}
        >
          {sortDirection === "asc" ? "▴" : "▾"}
        </button>
      </div>
      <table className={`file-list file-list--icon-${iconSize}`}>
        <thead>
          <tr>
            <th scope="col">
              <button className="file-list__sort-button" onClick={() => setSort("name")}>
                Name{sortField === "name" ? (sortDirection === "asc" ? " ▴" : " ▾") : ""}
              </button>
            </th>
            <th scope="col">
              <button className="file-list__sort-button" onClick={() => setSort("size")}>
                Size{sortField === "size" ? (sortDirection === "asc" ? " ▴" : " ▾") : ""}
              </button>
            </th>
            <th scope="col">
              <button className="file-list__sort-button" onClick={() => setSort("type")}>
                Type{sortField === "type" ? (sortDirection === "asc" ? " ▴" : " ▾") : ""}
              </button>
            </th>
            <th scope="col">
              <button className="file-list__sort-button" onClick={() => setSort("modified")}>
                Modified{sortField === "modified" ? (sortDirection === "asc" ? " ▴" : " ▾") : ""}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((entry, index) => (
            <tr
              key={entry.path}
              ref={(el) => {
                if (el) rowRefs.current.set(entry.path, el);
                else rowRefs.current.delete(entry.path);
              }}
              tabIndex={0}
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
              onKeyDown={(event) => handleRowKeyDown(event, index)}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelected(entry.path);
                setMenu({ path: entry.path, isDir: entry.isDir, x: event.clientX, y: event.clientY });
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
                    onBlur={() => {
                      if (suppressNextBlurRef.current) {
                        suppressNextBlurRef.current = false;
                        return;
                      }
                      void commitRename(entry.path);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void commitRename(entry.path);
                      if (event.key === "Escape") cancelRename();
                    }}
                  />
                ) : (
                  entry.name
                )}
              </td>
              <td>{formatSize(entry.size)}</td>
              <td>{entry.isDir ? "File folder" : extensionOf(entry.name)}</td>
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
              const path = menu.path;
              setMenu(null);
              setPendingDeletePath(path);
            }}
          >
            Delete
          </button>
          <div className="file-list__context-menu-separator" />
          {favoritePaths.includes(menu.path) ? (
            <button
              onClick={() => {
                removeFavorite(menu.path);
                setMenu(null);
              }}
            >
              Remove from Favorites
            </button>
          ) : (
            <button
              onClick={() => {
                addFavorite(menu.path);
                setMenu(null);
              }}
            >
              Add to Favorites
            </button>
          )}
          {contextMenuItems.length > 0 && (
            <>
              <div className="file-list__context-menu-separator" />
              {contextMenuItems.map((item) => (
                <button
                  key={`${item.pluginId}:${item.id}`}
                  onClick={() => {
                    const path = menu.path;
                    const isDir = menu.isDir;
                    setMenu(null);
                    item.onClick(path, isDir);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {pendingDeletePath && (
        <ConfirmDialog
          message="Move this item to the Recycle Bin?"
          confirmLabel="Delete"
          onConfirm={() => {
            const path = pendingDeletePath;
            setPendingDeletePath(null);
            void handleDelete(path);
          }}
          onCancel={() => setPendingDeletePath(null)}
        />
      )}
    </>
  );
}

export default FileList;
