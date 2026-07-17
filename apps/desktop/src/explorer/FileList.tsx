import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FixedSizeList } from "react-window";
import { invoke } from "@tauri-apps/api/core";
import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import { useSettingsStore, type SortDirection, type SortField } from "../stores/useSettingsStore";
import { usePluginStore } from "../stores/usePluginStore";
import { useToastStore } from "../stores/useToastStore";
import { performTransfer, performTransferBatch } from "../services/fileTransfer";
import ConfirmDialog from "../components/ConfirmDialog";
import FileTable from "./FileTable";
import VirtualFileTable from "./VirtualFileTable";
import { shouldVirtualize } from "./virtualization";
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

export function extensionOf(name: string): string {
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

// A single stable reference (not a fresh `[]` literal per render) so the `selectedSet` useMemo
// below doesn't get a "changed" dependency every render just because there's no active tab.
const EMPTY_SELECTION: string[] = [];

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
  const toggleSelected = useExplorerStore((state) => state.toggleSelected);
  const selectRange = useExplorerStore((state) => state.selectRange);
  const selectAll = useExplorerStore((state) => state.selectAll);
  const clearSelection = useExplorerStore((state) => state.clearSelection);
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
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameValueRef = useRef("");
  const draggingPathRef = useRef<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  // Guards against a rename committing twice: pressing Enter unmounts the rename <input> on the
  // next render, which fires a native blur that would otherwise re-invoke commitRename a second
  // time with the same value.
  const commitInFlightRef = useRef(false);
  const suppressNextBlurRef = useRef(false);
  // Set by focusRow when the target row isn't currently mounted (only possible once
  // VirtualFileTable exists) -- registerRow checks this on every row mount and focuses+clears it
  // if the newly-mounted row is the one that was pending.
  const pendingFocusPathRef = useRef<string | null>(null);
  const listRef = useRef<FixedSizeList>(null);

  const selectedPath = activeTab?.selectedPath ?? null;
  const selectedPaths = activeTab?.selectedPaths ?? EMPTY_SELECTION;
  const currentPath = activeTab?.history[activeTab.historyIndex] ?? null;
  const entries = activeTab?.entries;

  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  // Keyed on `entries` (not the whole tab object) so selecting an item — which only replaces
  // `selectedPath` on the tab, not `entries` — doesn't force an O(n log n) re-sort on every click.
  const sortedEntries = useMemo(
    () => sortEntries(entries ?? [], sortField, sortDirection),
    [entries, sortField, sortDirection],
  );

  const focusRow = useCallback((path: string, index: number) => {
    const el = rowRefs.current.get(path);
    if (el) {
      el.focus();
      return;
    }
    // Not currently mounted -- only reachable once VirtualFileTable exists (Task 6). Scroll it
    // into the rendered window; registerRow focuses it once it actually mounts.
    pendingFocusPathRef.current = path;
    listRef.current?.scrollToItem(index);
  }, []);

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      if (event.key === "ArrowDown" && index < sortedEntries.length - 1) {
        event.preventDefault();
        const next = sortedEntries[index + 1];
        setSelected(next.path);
        focusRow(next.path, index + 1);
      } else if (event.key === "ArrowUp" && index > 0) {
        event.preventDefault();
        const previous = sortedEntries[index - 1];
        setSelected(previous.path);
        focusRow(previous.path, index - 1);
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

  // Reads the anchor fresh via getState() instead of taking it as a reactive dependency — the
  // anchor changes on every plain/Ctrl+click, and this callback is passed uniformly to every
  // row, so depending on it reactively would give every row a "changed" onRowClick prop on every
  // click and defeat FileRow's memoization (see the comment on FileRow above).
  const handleRowClick = useCallback(
    (path: string, index: number, event: React.MouseEvent) => {
      pendingFocusPathRef.current = null;
      if (event.shiftKey) {
        const state = useExplorerStore.getState();
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        const anchor = tab?.selectionAnchor ?? path;
        const anchorIndex = sortedEntries.findIndex((e) => e.path === anchor);
        if (anchorIndex === -1) {
          setSelected(path);
          return;
        }
        const [start, end] = anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex];
        selectRange(sortedEntries.slice(start, end + 1).map((e) => e.path));
      } else if (event.ctrlKey || event.metaKey) {
        toggleSelected(path);
      } else {
        setSelected(path);
      }
    },
    [sortedEntries, setSelected, toggleSelected, selectRange],
  );

  const registerRow = useCallback((path: string, el: HTMLElement | null) => {
    if (el) {
      rowRefs.current.set(path, el);
      if (pendingFocusPathRef.current === path) {
        pendingFocusPathRef.current = null;
        el.focus();
      }
    } else {
      rowRefs.current.delete(path);
    }
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

  // Right-clicking a row that's already part of the current multi-selection keeps the whole
  // selection (matches Explorer/Finder); right-clicking anything else replaces it with just that
  // row, same as a plain click. Reads the selection fresh via getState() for the same reason
  // handleRowClick does — keeps this callback's identity stable across selection changes.
  const onRowContextMenu = useCallback(
    (path: string, isDir: boolean, x: number, y: number) => {
      const state = useExplorerStore.getState();
      const tab = state.tabs.find((t) => t.id === state.activeTabId);
      if (!tab?.selectedPaths.includes(path)) {
        setSelected(path);
      }
      setMenu({ path, isDir, x, y });
    },
    [setSelected],
  );

  const beginRename = useCallback(
    (path: string) => {
      const entry = entries?.find((e) => e.path === path);
      if (!entry) return;
      pendingFocusPathRef.current = null;
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

  // Navigating to a different folder or switching tabs both change `currentPath` without going
  // through any of this component's own handlers (navigateTo is called from breadcrumbs, the
  // drive list, search results, favorites, etc.) -- clear any pending scroll-then-focus so a stale
  // path can't steal focus if a same-named row later mounts in an unrelated view.
  useEffect(() => {
    pendingFocusPathRef.current = null;
  }, [currentPath]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (renamingPath) return;
      const isModified = event.ctrlKey || event.metaKey;

      if (isModified && event.key.toLowerCase() === "v") {
        if (clipboard && currentPath) {
          void performTransferBatch(clipboard.paths, currentPath, clipboard.mode === "cut" ? "move" : "copy");
        }
        return;
      }
      if (isModified && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAll(sortedEntries.map((entry) => entry.path));
        return;
      }
      if (event.key === "Escape") {
        pendingFocusPathRef.current = null;
        clearSelection();
        return;
      }
      if (selectedPaths.length === 0) return;
      if (isModified && event.key.toLowerCase() === "c") {
        setClipboard({ paths: selectedPaths, mode: "copy" });
      } else if (isModified && event.key.toLowerCase() === "x") {
        setClipboard({ paths: selectedPaths, mode: "cut" });
      } else if (event.key === "Delete") {
        setPendingDelete(selectedPaths);
      } else if (event.key === "F2" && selectedPaths.length === 1 && selectedPath) {
        beginRename(selectedPath);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedPath,
    selectedPaths,
    renamingPath,
    clipboard,
    currentPath,
    beginRename,
    sortedEntries,
    selectAll,
    clearSelection,
  ]);

  if (!activeTab) return null;
  const tab = activeTab;

  async function handleDeleteMany(paths: string[]) {
    for (const path of paths) {
      try {
        await invoke("delete_entry", { path });
      } catch (error) {
        showToast(String(error));
      }
    }
    clearSelection();
    refresh();
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
      {shouldVirtualize(sortedEntries.length) ? (
        <VirtualFileTable
          entries={sortedEntries}
          iconSize={iconSize}
          sortField={sortField}
          sortDirection={sortDirection}
          setSort={setSort}
          selectedSet={selectedSet}
          dragOverPath={dragOverPath}
          renamingPath={renamingPath}
          renameValue={renameValue}
          renameInputRef={renameInputRef}
          registerRow={registerRow}
          onRowClick={handleRowClick}
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
          listRef={listRef}
        />
      ) : (
        <FileTable
          entries={sortedEntries}
          iconSize={iconSize}
          sortField={sortField}
          sortDirection={sortDirection}
          setSort={setSort}
          selectedSet={selectedSet}
          dragOverPath={dragOverPath}
          renamingPath={renamingPath}
          renameValue={renameValue}
          renameInputRef={renameInputRef}
          registerRow={registerRow}
          onRowClick={handleRowClick}
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
      )}
      {menu && (
        <div
          className="file-list__context-menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              const paths = selectedPaths.includes(menu.path) ? selectedPaths : [menu.path];
              setClipboard({ paths, mode: "copy" });
              setMenu(null);
            }}
          >
            Copy
          </button>
          <button
            onClick={() => {
              const paths = selectedPaths.includes(menu.path) ? selectedPaths : [menu.path];
              setClipboard({ paths, mode: "cut" });
              setMenu(null);
            }}
          >
            Cut
          </button>
          <button onClick={() => beginRename(menu.path)}>Rename</button>
          <button
            onClick={() => {
              const paths = selectedPaths.includes(menu.path) ? selectedPaths : [menu.path];
              setMenu(null);
              setPendingDelete(paths);
            }}
          >
            {selectedPaths.includes(menu.path) && selectedPaths.length > 1
              ? `Delete ${selectedPaths.length} items`
              : "Delete"}
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
      {pendingDelete && (
        <ConfirmDialog
          message={
            pendingDelete.length > 1
              ? `Move ${pendingDelete.length} items to the Recycle Bin?`
              : "Move this item to the Recycle Bin?"
          }
          confirmLabel="Delete"
          onConfirm={() => {
            const paths = pendingDelete;
            setPendingDelete(null);
            void handleDeleteMany(paths);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}

export default FileList;
