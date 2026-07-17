import { memo, useMemo } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { useElementSize } from "../hooks/useElementSize";
import { extensionOf, formatModified, formatSize } from "./FileList";
import { ROW_HEIGHT_PX } from "./virtualization";
import type { SortDirection, SortField } from "../stores/useSettingsStore";
import type { EntryInfo } from "../types/filesystem";
import type { FileTableProps } from "./FileTable";

const GRID_TEMPLATE_COLUMNS = "1fr 90px 110px 170px";

interface RowData {
  entries: EntryInfo[];
  selectedSet: Set<string>;
  dragOverPath: string | null;
  renamingPath: string | null;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  registerRow: (path: string, el: HTMLDivElement | null) => void;
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

const VirtualRow = memo(function VirtualRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const entry = data.entries[index];
  const isSelected = data.selectedSet.has(entry.path);
  const isDragOver = entry.path === data.dragOverPath;
  const isRenaming = entry.path === data.renamingPath;

  return (
    <div
      ref={(el) => data.registerRow(entry.path, el)}
      role="row"
      tabIndex={0}
      style={{ ...style, display: "grid", gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
      className={[
        "file-list__row",
        "file-list__row--grid",
        isSelected ? "file-list__row--selected" : "",
        isDragOver ? "file-list__row--drag-over" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable
      onClick={(event) => data.onRowClick(entry.path, index, event)}
      onDoubleClick={() => entry.isDir && data.onNavigate(entry.path)}
      onKeyDown={(event) => data.onRowKeyDown(event, index)}
      onContextMenu={(event) => {
        event.preventDefault();
        data.onContextMenu(entry.path, entry.isDir, event.clientX, event.clientY);
      }}
      onDragStart={(event) => {
        data.onDragStart(entry.path);
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData("text/plain", entry.path);
      }}
      onDragEnd={data.onDragEnd}
      onDragOver={(event) => {
        if (!entry.isDir || data.isDragSource(entry.path)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
      }}
      onDragEnter={(event) => {
        if (!entry.isDir || data.isDragSource(entry.path)) return;
        event.preventDefault();
        data.onDragEnter(entry.path);
      }}
      onDragLeave={() => data.onDragLeave(entry.path)}
      onDrop={(event) => entry.isDir && data.onDrop(event, entry.path)}
    >
      <div role="gridcell" className={isRenaming ? "file-list__gridcell--editing" : undefined}>
        {entry.isDir ? "\u{1F4C1} " : "\u{1F4C4} "}
        {isRenaming ? (
          <input
            ref={(el) => {
              (data.renameInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
              if (el) {
                el.focus();
                el.select();
              }
            }}
            className="file-list__rename-input"
            value={data.renameValue}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => data.onRenameChange(event.target.value)}
            onBlur={() => data.onRenameBlur(entry.path)}
            onKeyDown={(event) => {
              if (event.key === "Enter") data.onRenameCommit(entry.path);
              if (event.key === "Escape") data.onRenameCancel();
            }}
          />
        ) : (
          entry.name
        )}
      </div>
      <div role="gridcell">{formatSize(entry.size)}</div>
      <div role="gridcell">{entry.isDir ? "File folder" : extensionOf(entry.name)}</div>
      <div role="gridcell">{formatModified(entry.modified)}</div>
    </div>
  );
});

export interface VirtualFileTableProps extends Omit<FileTableProps, "registerRow"> {
  registerRow: (path: string, el: HTMLElement | null) => void;
  listRef: React.RefObject<FixedSizeList>;
}

function SortHeaderCell({
  label,
  field,
  sortField,
  sortDirection,
  setSort,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDirection: SortDirection;
  setSort: (field: SortField) => void;
}) {
  return (
    <div role="columnheader">
      <button className="file-list__sort-button" onClick={() => setSort(field)}>
        {label}
        {sortField === field ? (sortDirection === "asc" ? " ▴" : " ▾") : ""}
      </button>
    </div>
  );
}

function VirtualFileTable({
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
  listRef,
}: VirtualFileTableProps) {
  const [sizeRef, size] = useElementSize<HTMLDivElement>();

  const itemData = useMemo<RowData>(
    () => ({
      entries,
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
    }),
    [
      entries,
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
    ],
  );

  return (
    <div
      role="table"
      className={`file-list file-list--icon-${iconSize} file-list--virtual`}
    >
      <div role="row" className="file-list__header-row" style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}>
        <SortHeaderCell label="Name" field="name" sortField={sortField} sortDirection={sortDirection} setSort={setSort} />
        <SortHeaderCell label="Size" field="size" sortField={sortField} sortDirection={sortDirection} setSort={setSort} />
        <SortHeaderCell label="Type" field="type" sortField={sortField} sortDirection={sortDirection} setSort={setSort} />
        <SortHeaderCell label="Modified" field="modified" sortField={sortField} sortDirection={sortDirection} setSort={setSort} />
      </div>
      <div ref={sizeRef} role="rowgroup" className="file-list__virtual-body">
        {size.height > 0 && (
          <FixedSizeList
            ref={listRef}
            height={size.height}
            width={size.width}
            itemCount={entries.length}
            itemSize={ROW_HEIGHT_PX[iconSize]}
            itemData={itemData}
            style={{ overflowY: "scroll" }}
          >
            {VirtualRow}
          </FixedSizeList>
        )}
      </div>
    </div>
  );
}

export default VirtualFileTable;
