# File List Virtualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render large folders (>150 entries) through a virtualized file list so only visible
rows exist in the DOM, while leaving today's table rendering completely untouched for
typical/small folders.

**Architecture:** `FileList.tsx` keeps owning all state and interaction logic (sorting,
selection, keyboard nav, drag-and-drop, rename, context menu) and picks between two sibling
presentational components based on entry count: `FileTable` (today's exact `<table>` markup,
extracted verbatim) for folders at or below the threshold, and a new `VirtualFileTable`
(`react-window`-backed, CSS Grid rows) above it.

**Tech Stack:** React 18, TypeScript, `react-window` (new dependency), Vitest.

Full design: `docs/superpowers/specs/2026-07-17-file-list-virtualization-design.md`.

---

### Task 1: Add the `react-window` dependency

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Install the package**

Run: `cd apps/desktop && npm install react-window@^1.8.11 && npm install --save-dev @types/react-window@^1`

Expected: `apps/desktop/package.json`'s `"dependencies"` gains a `"react-window": "^1.8.11"` line
and `"devDependencies"` gains `"@types/react-window": "^1.8.8"`; `apps/desktop/package-lock.json`
updates. (Correction from an earlier draft of this plan: `react-window` itself ships only Flow
type stubs, not TypeScript `.d.ts` files — without `@types/react-window`, `FixedSizeList` and
`ListChildComponentProps` silently resolve to `any` with no compile-time checking at all. The
separate types package is required.)

- [ ] **Step 2: Verify types resolve**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors (nothing imports `react-window` yet, this just confirms the install didn't
break anything).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json apps/desktop/package-lock.json
git commit -m "Add react-window for file list virtualization"
```

---

### Task 2: Virtualization threshold and row-height constants

**Task 1 status: already implemented and reviewed as of this plan's current state** (commits
`2527904` and `004e0fb`). `react-window@1.8.11` and `@types/react-window@^1.8.8` are both
installed and confirmed to provide real TypeScript type-checking (not `any`).

**Files:**
- Create: `apps/desktop/src/explorer/virtualization.ts`
- Create: `apps/desktop/src/explorer/virtualization.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/explorer/virtualization.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ROW_HEIGHT_PX, shouldVirtualize, VIRTUALIZATION_THRESHOLD } from "./virtualization";

describe("shouldVirtualize", () => {
  it("is false at or below the threshold", () => {
    expect(shouldVirtualize(VIRTUALIZATION_THRESHOLD)).toBe(false);
    expect(shouldVirtualize(1)).toBe(false);
    expect(shouldVirtualize(0)).toBe(false);
  });

  it("is true above the threshold", () => {
    expect(shouldVirtualize(VIRTUALIZATION_THRESHOLD + 1)).toBe(true);
  });
});

describe("ROW_HEIGHT_PX", () => {
  it("defines a positive height for every icon size", () => {
    expect(ROW_HEIGHT_PX.small).toBeGreaterThan(0);
    expect(ROW_HEIGHT_PX.medium).toBeGreaterThan(0);
    expect(ROW_HEIGHT_PX.large).toBeGreaterThan(0);
  });

  it("increases with icon size", () => {
    expect(ROW_HEIGHT_PX.medium).toBeGreaterThan(ROW_HEIGHT_PX.small);
    expect(ROW_HEIGHT_PX.large).toBeGreaterThan(ROW_HEIGHT_PX.medium);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npm test -- --run virtualization`
Expected: FAIL — `./virtualization` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/explorer/virtualization.ts`:

```ts
import type { IconSize } from "../stores/useSettingsStore";

/** Folders at or below this many entries render through the plain, non-virtualized <table>
 * path (FileTable) -- comfortably above where that path is smooth. Folders above it render
 * through VirtualFileTable instead. See
 * docs/superpowers/specs/2026-07-17-file-list-virtualization-design.md. */
export const VIRTUALIZATION_THRESHOLD = 150;

export function shouldVirtualize(entryCount: number): boolean {
  return entryCount > VIRTUALIZATION_THRESHOLD;
}

/** Fixed pixel row height per icon size, used as VirtualFileTable's FixedSizeList itemSize.
 * Matches FileTable's browser-computed row height (padding + font-size, see FileList.css) at
 * each icon size, so crossing VIRTUALIZATION_THRESHOLD doesn't visibly jump. */
export const ROW_HEIGHT_PX: Record<IconSize, number> = {
  small: 24,
  medium: 28,
  large: 36,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/desktop && npm test -- --run virtualization`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/explorer/virtualization.ts apps/desktop/src/explorer/virtualization.test.ts
git commit -m "Add virtualization threshold and row-height constants"
```

---

### Task 3: Extract `FileTable` from `FileList` (behavior-preserving refactor)

This moves the existing `<table>` markup and `FileRow` component out of `FileList.tsx` into
their own file, changing nothing about behavior — `FileList.tsx` renders the same output as
before, just via the new `<FileTable>` component. This is the file `VirtualFileTable` (Task 5)
will sit alongside as a sibling.

**Files:**
- Create: `apps/desktop/src/explorer/FileTable.tsx`
- Modify: `apps/desktop/src/explorer/FileList.tsx`

- [ ] **Step 1: Create `FileTable.tsx`**

Create `apps/desktop/src/explorer/FileTable.tsx` with this content (the `FileRow` component and
the `<table>` JSX, moved verbatim from `FileList.tsx`, plus the props `FileList` passes them):

```tsx
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
```

- [ ] **Step 2: Update `FileList.tsx`**

In `apps/desktop/src/explorer/FileList.tsx`:

1. Export `extensionOf` (VirtualFileTable will need it in Task 5, and FileTable.tsx above already
   imports it as exported) — change:

   ```ts
   function extensionOf(name: string): string {
   ```

   to:

   ```ts
   export function extensionOf(name: string): string {
   ```

2. Delete the entire `FileRowProps` interface and the `FileRow` component (now living in
   `FileTable.tsx`) — everything from `interface FileRowProps {` through the closing `});` of the
   `FileRow` component definition.

3. Add the import at the top of the file:

   ```ts
   import FileTable from "./FileTable";
   ```

4. Replace the `<table className={...}>...</table>` block (the whole table, from
   `<table className={\`file-list file-list--icon-${iconSize}\`}>` through its closing
   `</table>`) with:

   ```tsx
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
   ```

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors; all existing tests still pass (this step changes no behavior, so
nothing should break — `FileList.test.ts`'s `formatSize`/`formatModified`/`sortEntries` tests are
unaffected since those functions stay in `FileList.tsx`).

- [ ] **Step 4: Manually verify no visual/behavioral change**

Run the dev build (`npm run tauri dev` from `apps/desktop`) and confirm the file list still
renders, sorts, selects, drags, renames, and right-clicks exactly as before. This step is a pure
refactor — anything different here is a bug in the extraction, not an intentional change.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/explorer/FileTable.tsx apps/desktop/src/explorer/FileList.tsx
git commit -m "Extract FileTable from FileList as a standalone component"
```

---

### Task 4: Generalize row focus/keyboard-nav plumbing for cross-boundary focus

`VirtualFileTable` (Task 5) will need to bring an off-screen row into the rendered window before
it can be focused. This task generalizes `FileList`'s existing focus machinery to support that,
**without changing any behavior yet** — `FileTable` always keeps every row mounted, so the new
"pending focus" path is simply never exercised until Task 6 wires in `VirtualFileTable`.

Note on testing: the design spec calls for unit tests on "pure-logic additions" including the
pending-focus resolution. Unlike `shouldVirtualize`/`ROW_HEIGHT_PX` (Task 2), this logic isn't
actually extractable as a pure function — it's fundamentally about *DOM refs and imperative
`.focus()` calls tied to component-instance state* (`rowRefs`, `pendingFocusPathRef`), the same
category as `useElementSize`'s `ResizeObserver` usage in Task 5. There's no established pattern
in this codebase for testing that kind of stateful/imperative logic in isolation (see
`FileList.test.ts`, which only covers pure helpers). This task's Step 7 and Task 6's Step 6
manual-verification checklist cover it by hand instead.

**Files:**
- Modify: `apps/desktop/src/explorer/FileList.tsx`

- [ ] **Step 1: Widen the `rowRefs` map type**

Change:

```ts
const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
```

to:

```ts
const rowRefs = useRef(new Map<string, HTMLElement>());
```

(`FileTable`'s `registerRow` prop is typed `(path: string, el: HTMLTableRowElement | null) => void`;
a callback typed `(path: string, el: HTMLElement | null) => void` is assignable there because
TypeScript checks function parameters contravariantly — a function that can handle any
`HTMLElement` can certainly handle the narrower `HTMLTableRowElement`. No cast needed.)

- [ ] **Step 2: Add a pending-focus ref and a `FixedSizeList` ref**

Add near the other refs (after `rowRefs`):

```ts
// Set by focusRow when the target row isn't currently mounted (only possible once
// VirtualFileTable exists) -- registerRow checks this on every row mount and focuses+clears it
// if the newly-mounted row is the one that was pending.
const pendingFocusPathRef = useRef<string | null>(null);
const listRef = useRef<FixedSizeList>(null);
```

Add the import at the top of the file:

```ts
import type { FixedSizeList } from "react-window";
```

- [ ] **Step 3: Update `registerRow` to resolve pending focus**

Change:

```ts
const registerRow = useCallback((path: string, el: HTMLTableRowElement | null) => {
  if (el) rowRefs.current.set(path, el);
  else rowRefs.current.delete(path);
}, []);
```

to:

```ts
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
```

- [ ] **Step 4: Update `focusRow` to take an index and fall back to scroll+pend**

Change:

```ts
const focusRow = useCallback((path: string) => {
  rowRefs.current.get(path)?.focus();
}, []);
```

to:

```ts
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
```

- [ ] **Step 5: Update `focusRow`'s two call sites**

In `handleRowKeyDown`, change:

```ts
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
```

to:

```ts
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
```

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors; all tests pass (behavior is unchanged — `listRef`/`pendingFocusPathRef`
are inert until Task 6).

- [ ] **Step 7: Manually verify keyboard navigation still works**

Run the dev build and confirm arrow-key navigation between rows still moves selection and focus
correctly (this exercises the `el.focus()` early-return path, since every row is still always
mounted at this point).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/explorer/FileList.tsx
git commit -m "Generalize row focus plumbing to support scrolling to unmounted rows"
```

---

### Task 5: Add `useElementSize` hook and build `VirtualFileTable`

**Files:**
- Create: `apps/desktop/src/hooks/useElementSize.ts`
- Create: `apps/desktop/src/explorer/VirtualFileTable.tsx`
- Modify: `apps/desktop/src/explorer/FileList.css`

- [ ] **Step 1: Create `useElementSize`**

`FixedSizeList` needs an explicit pixel `height`/`width`, but the file list's container is
whatever size the surrounding layout gives it. This hook measures a ref'd element via
`ResizeObserver` and returns its current content box size.

Create `apps/desktop/src/hooks/useElementSize.ts`:

```ts
import { useEffect, useRef, useState } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/** Tracks a ref'd element's content-box size via ResizeObserver. Returns { width: 0, height: 0 }
 * until the element is mounted and the first observation fires. Not unit-tested here -- like
 * TerminalWindow's existing ResizeObserver usage, this is a thin wrapper around a browser API
 * that isn't meaningfully testable without a heavy DOM mock, and this codebase's convention is
 * to verify interactive/layout behavior by hand rather than fake-test it. */
export function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, ElementSize] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
```

- [ ] **Step 2: Create `VirtualFileTable.tsx`**

Create `apps/desktop/src/explorer/VirtualFileTable.tsx`:

```tsx
import { memo, useMemo } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { useElementSize } from "../hooks/useElementSize";
import { extensionOf, formatModified, formatSize } from "./FileList";
import { ROW_HEIGHT_PX } from "./virtualization";
import type { IconSize, SortDirection, SortField } from "../stores/useSettingsStore";
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
      <div role="gridcell">
        {entry.isDir ? "\u{1F4C1} " : "\u{1F4C4} "}
        {isRenaming ? (
          <input
            ref={data.renameInputRef}
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
      <div ref={sizeRef} className="file-list__virtual-body">
        {size.height > 0 && (
          <FixedSizeList
            ref={listRef}
            height={size.height}
            width={size.width}
            itemCount={entries.length}
            itemSize={ROW_HEIGHT_PX[iconSize]}
            itemData={itemData}
          >
            {VirtualRow}
          </FixedSizeList>
        )}
      </div>
    </div>
  );
}

export default VirtualFileTable;
```

- [ ] **Step 3: Add CSS for the virtualized grid**

Append to `apps/desktop/src/explorer/FileList.css`:

```css
.file-list--virtual {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.file-list__header-row {
  display: grid;
  padding: 0;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.file-list__header-row [role="columnheader"] {
  padding: 6px 10px;
}

.file-list__virtual-body {
  flex: 1;
  min-height: 0;
}

.file-list__row--grid {
  align-items: center;
  box-sizing: border-box;
  border-bottom: none;
}

.file-list__row--grid [role="gridcell"] {
  padding: 4px 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors. (`VirtualFileTable` isn't rendered from anywhere yet, so this only proves
it compiles in isolation — Task 6 wires it in.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/useElementSize.ts apps/desktop/src/explorer/VirtualFileTable.tsx apps/desktop/src/explorer/FileList.css
git commit -m "Add VirtualFileTable and useElementSize hook"
```

---

### Task 6: Wire the threshold branch into `FileList` and verify

**Files:**
- Modify: `apps/desktop/src/explorer/FileList.tsx`

- [ ] **Step 1: Import the new pieces**

Add to the imports in `apps/desktop/src/explorer/FileList.tsx`:

```ts
import VirtualFileTable from "./VirtualFileTable";
import { shouldVirtualize } from "./virtualization";
```

- [ ] **Step 2: Branch on the threshold**

Replace the `<FileTable ... />` element added in Task 3 with:

```tsx
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
```

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors; all tests pass.

- [ ] **Step 4: Production build**

Run: `cd apps/desktop && npm run build`
Expected: builds successfully; note the resulting chunk sizes (react-window is small, ~3KB
gzipped, so the main bundle should grow only marginally).

- [ ] **Step 5: Full workspace verification**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: all green (this repeats Steps 3-4 as a single final gate).

- [ ] **Step 6: Manual verification (cannot be automated)**

Run the dev build (`npm run tauri dev` from `apps/desktop`) and check:

1. A folder with well under 150 entries still renders through the plain table (unchanged look
   and feel) — sort, select, drag-and-drop, rename, right-click context menu, arrow-key
   navigation all work exactly as before.
2. Create or navigate to a folder with 150+ entries (e.g. a large `node_modules/.bin` or similar,
   or generate a throwaway test folder with a few hundred files). Confirm:
   - The list renders promptly and scrolling is smooth — this is the actual performance win
     being verified.
   - Sorting, selecting, dragging, renaming, and right-clicking all work per-row, same as the
     small-folder case.
   - Arrow-key navigation from a visible row down/up past the edge of the rendered window
     correctly scrolls the target row into view and focuses it (this exercises the
     `pendingFocusPathRef`/`scrollToItem` path from Task 4 for the first time).
   - Ctrl+A selects everything, including rows that were never scrolled into view.
   - Resizing the app window resizes the virtualized list correctly (exercises
     `useElementSize`'s `ResizeObserver`).
3. Toggle icon size (small/medium/large) in Settings while viewing a large folder — row heights
   should update and stay visually consistent with how the small-folder table looks at each
   size.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/explorer/FileList.tsx
git commit -m "Wire VirtualFileTable in above the entry-count threshold"
```
