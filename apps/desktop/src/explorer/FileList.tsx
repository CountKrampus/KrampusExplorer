import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface FileRowProps {
  entry: EntryInfo;
  index: number;
  isSelected: boolean;
  isDragOver: boolean;
  isRenaming: boolean;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  registerRow: (path: string, el: HTMLTableRowElement | null) => void;
  onSelect: (path: string) => void;
  onNavigate: (path: string) => void;
  onRowKeyDown: (event: React.KeyboardEvent, index: number) => void;
  onContextMenu: (path: string, isDir: boolean, x: number, y: number) => void;
  isDragSource: (path: string) => boolean;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  onDragEnter: (path: string) => void;
  onDragLeave: (path: string) => void;
  onDrop: (event: React.DragEvent, path: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: (path: string) => void;
  onRenameCancel: () => void;
  onRenameBlur: (path: string) => void;
}

/** Memoized so selecting/deselecting one row only re-renders the (at most two) rows whose
 * `isSelected`/`isDragOver` actually flipped, instead of every row in the folder. All callback
 * props are stable across selection clicks (see the `useCallback`s in FileList) so React.memo's
 * shallow prop comparison actually holds. */
const FileRow = memo(function FileRow({
  entry,
  index,
  isSelected,
  isDragOver,
  isRenaming,
  renameValue,
  renameInputRef,
  registerRow,
  onSelect,
  onNavigate,
  onRowKeyDown,
  onContextMenu,
  isDragSource,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDrop,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onRenameBlur,
}: FileRowProps) {
  return (
    <tr
      ref={(el) => registerRow(entry.path, el)}
      tabIndex={0}
      className={[
        "file-list__row",
        isSelected ? "file-list__row--selected" : "",
        isDragOver ? "file-list__row--drag-over" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable
      onClick={() => onSelect(entry.path)}
      onDoubleClick={() => entry.isDir && onNavigate(entry.path)}
      onKeyDown={(event) => onRowKeyDown(event, index)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(entry.path, entry.isDir, event.clientX, event.clientY);
      }}
      onDragStart={(event) => {
        onDragStart(entry.path);
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData("text/plain", entry.path);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!entry.isDir || isDragSource(entry.path)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
      }}
      onDragEnter={(event) => {
        if (!entry.isDir || isDragSource(entry.path)) return;
        event.preventDefault();
        onDragEnter(entry.path);
      }}
      onDragLeave={() => onDragLeave(entry.path)}
      onDrop={(event) => entry.isDir && onDrop(event, entry.path)}
    >
      <td>
        {entry.isDir ? "\u{1F4C1} " : "\u{1F4C4} "}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="file-list__rename-input"
            value={renameValue}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onRenameChange(event.target.value)}
            onBlur={() => onRenameBlur(entry.path)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onRenameCommit(entry.path);
              if (event.key === "Escape") onRenameCancel();
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
  );
});

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
  const renameValueRef = useRef("");
  const draggingPathRef = useRef<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  // Guards against a rename committing twice: pressing Enter unmounts the rename <input> on the
  // next render, which fires a native blur that would otherwise re-invoke commitRename a second
  // time with the same value.
  const commitInFlightRef = useRef(false);
  const suppressNextBlurRef = useRef(false);

  const selectedPath = activeTab?.selectedPath ?? null;
  const currentPath = activeTab?.history[activeTab.historyIndex] ?? null;
  const entries = activeTab?.entries;

  // Keyed on `entries` (not the whole tab object) so selecting an item — which only replaces
  // `selectedPath` on the tab, not `entries` — doesn't force an O(n log n) re-sort on every click.
  const sortedEntries = useMemo(
    () => sortEntries(entries ?? [], sortField, sortDirection),
    [entries, sortField, sortDirection],
  );

  const focusRow = useCallback((path: string) => {
    rowRefs.current.get(path)?.focus();
  }, []);

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      if (event.key === "ArrowDown" && index < sortedEntries.length - 1) {
        event.preventDefault();
        const next = sortedEntries[index + 1];
        setSelected(next.path);
        focusRow(next.path);
      } else if (event.key === "ArrowUp" && index > 0) {
        event.preventDefault();
        const previous = sortedEntries[index - 1];
        setSelected(previous.path);
        focusRow(previous.path);
      } else if (event.key === "Enter") {
        const entry = sortedEntries[index];
        if (entry.isDir) {
          event.preventDefault();
          navigateTo(entry.path);
        }
      }
    },
    [sortedEntries, setSelected, focusRow, navigateTo],
  );

  const registerRow = useCallback((path: string, el: HTMLTableRowElement | null) => {
    if (el) rowRefs.current.set(path, el);
    else rowRefs.current.delete(path);
  }, []);

  const isDragSource = useCallback((path: string) => draggingPathRef.current === path, []);

  const onRowDragStart = useCallback((path: string) => {
    draggingPathRef.current = path;
  }, []);

  const onRowDragEnd = useCallback(() => {
    draggingPathRef.current = null;
    setDragOverPath(null);
  }, []);

  const onRowDragEnter = useCallback((path: string) => {
    setDragOverPath(path);
  }, []);

  const onRowDragLeave = useCallback((path: string) => {
    setDragOverPath((current) => (current === path ? null : current));
  }, []);

  const onRowDrop = useCallback((event: React.DragEvent, destDir: string) => {
    event.preventDefault();
    setDragOverPath(null);
    const sourcePath = draggingPathRef.current;
    draggingPathRef.current = null;
    if (!sourcePath || sourcePath === destDir) return;
    void performTransfer(sourcePath, destDir, event.ctrlKey ? "copy" : "move");
  }, []);

  const onRowContextMenu = useCallback(
    (path: string, isDir: boolean, x: number, y: number) => {
      setSelected(path);
      setMenu({ path, isDir, x, y });
    },
    [setSelected],
  );

  const beginRename = useCallback(
    (path: string) => {
      const entry = entries?.find((e) => e.path === path);
      if (!entry) return;
      setRenamingPath(path);
      setRenameValue(entry.name);
      renameValueRef.current = entry.name;
      setMenu(null);
    },
    [entries],
  );

  const onRenameChange = useCallback((value: string) => {
    renameValueRef.current = value;
    setRenameValue(value);
  }, []);

  const commitRename = useCallback(
    async (path: string) => {
      if (commitInFlightRef.current) return;
      commitInFlightRef.current = true;
      setRenamingPath(null);
      try {
        const name = renameValueRef.current.trim();
        const entry = entries?.find((e) => e.path === path);
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
    },
    [entries, setSelected, refresh, showToast],
  );

  const handleRenameCommit = useCallback(
    (path: string) => {
      void commitRename(path);
    },
    [commitRename],
  );

  const cancelRename = useCallback(() => {
    suppressNextBlurRef.current = true;
    setRenamingPath(null);
  }, []);

  const onRenameBlur = useCallback(
    (path: string) => {
      if (suppressNextBlurRef.current) {
        suppressNextBlurRef.current = false;
        return;
      }
      void commitRename(path);
    },
    [commitRename],
  );

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
  }, [selectedPath, renamingPath, clipboard, currentPath, beginRename]);

  if (!activeTab) return null;
  const tab = activeTab;

  async function handleDelete(path: string) {
    try {
      await invoke("delete_entry", { path });
      setSelected(null);
      refresh();
    } catch (error) {
      showToast(String(error));
    }
  }

  if (tab.error) {
    return (
      <div className="file-list-message file-list-message--error">
        <p>{tab.error}</p>
        <button onClick={refresh}>Retry</button>
      </div>
    );
  }

  if (tab.loading) {
    return <div className="file-list-message">Loading…</div>;
  }

  if (tab.entries.length === 0) {
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
            <FileRow
              key={entry.path}
              entry={entry}
              index={index}
              isSelected={entry.path === selectedPath}
              isDragOver={entry.path === dragOverPath}
              isRenaming={entry.path === renamingPath}
              renameValue={entry.path === renamingPath ? renameValue : ""}
              renameInputRef={renameInputRef}
              registerRow={registerRow}
              onSelect={setSelected}
              onNavigate={navigateTo}
              onRowKeyDown={handleRowKeyDown}
              onContextMenu={onRowContextMenu}
              isDragSource={isDragSource}
              onDragStart={onRowDragStart}
              onDragEnd={onRowDragEnd}
              onDragEnter={onRowDragEnter}
              onDragLeave={onRowDragLeave}
              onDrop={onRowDrop}
              onRenameChange={onRenameChange}
              onRenameCommit={handleRenameCommit}
              onRenameCancel={cancelRename}
              onRenameBlur={onRenameBlur}
            />
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
