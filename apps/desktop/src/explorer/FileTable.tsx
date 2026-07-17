import { memo } from "react";
import { extensionOf, formatModified, formatSize } from "./FileList";
import type { IconSize, SortDirection, SortField } from "../stores/useSettingsStore";
import type { EntryInfo } from "../types/filesystem";

interface FileRowProps {
  entry: EntryInfo;
  index: number;
  isSelected: boolean;
  isDragOver: boolean;
  isRenaming: boolean;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  registerRow: (path: string, el: HTMLTableRowElement | null) => void;
  onRowClick: (path: string, index: number, event: React.MouseEvent) => void;
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
  onRowClick,
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
      onClick={(event) => onRowClick(entry.path, index, event)}
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
            ref={(el) => {
              (renameInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
              if (el) {
                el.focus();
                el.select();
              }
            }}
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

export interface FileTableProps {
  entries: EntryInfo[];
  iconSize: IconSize;
  sortField: SortField;
  sortDirection: SortDirection;
  setSort: (field: SortField) => void;
  selectedSet: Set<string>;
  dragOverPath: string | null;
  renamingPath: string | null;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  registerRow: (path: string, el: HTMLTableRowElement | null) => void;
  onRowClick: (path: string, index: number, event: React.MouseEvent) => void;
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

function FileTable({
  entries,
  iconSize,
  sortField,
  sortDirection,
  setSort,
  selectedSet,
  dragOverPath,
  renamingPath,
  renameValue,
  renameInputRef,
  registerRow,
  onRowClick,
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
}: FileTableProps) {
  return (
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
        {entries.map((entry, index) => (
          <FileRow
            key={entry.path}
            entry={entry}
            index={index}
            isSelected={selectedSet.has(entry.path)}
            isDragOver={entry.path === dragOverPath}
            isRenaming={entry.path === renamingPath}
            renameValue={entry.path === renamingPath ? renameValue : ""}
            renameInputRef={renameInputRef}
            registerRow={registerRow}
            onRowClick={onRowClick}
            onNavigate={onNavigate}
            onRowKeyDown={onRowKeyDown}
            onContextMenu={onContextMenu}
            isDragSource={isDragSource}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onRenameChange={onRenameChange}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            onRenameBlur={onRenameBlur}
          />
        ))}
      </tbody>
    </table>
  );
}

export default FileTable;
