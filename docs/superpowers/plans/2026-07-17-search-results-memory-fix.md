# Search Results Memory Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a real, easily-triggered bug where a broad search returns an unbounded result set,
driving WebView2 renderer memory into multiple gigabytes — cap results at the source and
virtualize their rendering so even the capped size stays cheap.

**Architecture:** Backend `search()` gets a hard `LIMIT`; the frontend shows a truncation banner
when the cap is hit, and `SearchResults.tsx` (now the state/logic owner, mirroring `FileList.tsx`)
picks between the existing plain-table rendering and a new `react-window`-backed virtualized
component based on the existing 150-entry threshold already used by the file list.

**Tech Stack:** Rust (rusqlite), React, TypeScript, `react-window` (already a dependency).

Full design: `docs/superpowers/specs/2026-07-17-search-results-memory-fix-design.md`.

---

### Task 1: Backend result cap

**Files:**
- Modify: `crates/search/src/query.rs`

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `crates/search/src/query.rs` (after the existing
`search_scales_to_five_thousand_indexed_entries` test):

```rust
    #[test]
    fn search_caps_results_at_search_result_cap() {
        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let root = "C:\\synthetic-root-cap";
        let mut conn = crate::db::open_connection(Some(&db_path)).unwrap();
        let tx = conn.transaction().unwrap();
        for i in 0..(SEARCH_RESULT_CAP + 50) {
            tx.execute(
                "INSERT INTO index_entries (root, path, name, is_dir, size, modified)
                 VALUES (?1, ?2, ?3, 0, ?4, 0)",
                rusqlite::params![
                    root,
                    format!("{root}\\item_{i:05}.txt"),
                    format!("item_{i:05}.txt"),
                    i as i64,
                ],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        drop(conn);

        let results = search(root, &SearchFilters::default(), Some(&db_path)).unwrap();

        assert_eq!(results.len(), SEARCH_RESULT_CAP);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p explorer-search search_caps_results_at_search_result_cap`
Expected: FAIL — `SEARCH_RESULT_CAP` doesn't exist yet, and even once referenced, the query
currently returns all 550 rows instead of 500.

- [ ] **Step 3: Add the cap constant and LIMIT clause**

In `crates/search/src/query.rs`, add near the top of the file (after the existing `use`
statements, before `escape_like`):

```rust
/// Hard cap on the number of rows a single search() call can return, applied regardless of
/// filters. Without this, a broad query (e.g. a single common letter) over a large indexed tree
/// can return an effectively unbounded result set -- in manual testing, rendering one such
/// unbounded result set drove a WebView2 renderer process past 9GB of memory. 500 is generous
/// enough to cover real search intent (matching in the many hundreds usually means the query
/// needs narrowing, not that the user wants to scroll through all of them) while keeping
/// worst-case IPC payload and render cost small. The frontend's `SEARCH_RESULT_CAP` in
/// `apps/desktop/src/stores/useSearchStore.ts` must be kept in sync with this value.
pub const SEARCH_RESULT_CAP: usize = 500;
```

Then change:

```rust
    sql.push_str(" ORDER BY is_dir DESC, name COLLATE NOCASE ASC");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Could not prepare search query: {e}"))?;
    let params_refs: Vec<&dyn ToSql> = query_params.iter().map(|p| p.as_ref()).collect();
```

to:

```rust
    sql.push_str(" ORDER BY is_dir DESC, name COLLATE NOCASE ASC LIMIT ?");
    query_params.push(Box::new(SEARCH_RESULT_CAP as i64));

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Could not prepare search query: {e}"))?;
    let params_refs: Vec<&dyn ToSql> = query_params.iter().map(|p| p.as_ref()).collect();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p explorer-search search_caps_results_at_search_result_cap`
Expected: PASS.

- [ ] **Step 5: Run the full search crate test suite**

Run: `cargo test -p explorer-search`
Expected: all tests pass, including the pre-existing `search_with_no_filters_returns_everything_under_root`
(4 rows, well under the 500 cap, so it's unaffected) and
`search_scales_to_five_thousand_indexed_entries` (which searches for one specific unique name, so
it still returns exactly 1 result, unaffected by the cap).

- [ ] **Step 6: Commit**

```bash
git add crates/search/src/query.rs
git commit -m "Cap search results at 500 rows to prevent unbounded memory growth"
```

---

### Task 2: Frontend truncation banner

**Files:**
- Modify: `apps/desktop/src/stores/useSearchStore.ts`
- Modify: `apps/desktop/src/explorer/SearchResults.tsx`
- Modify: `apps/desktop/src/explorer/SearchResults.css`
- Create: `apps/desktop/src/explorer/SearchResults.test.ts`

This task adds the truncation banner only — the table itself is still the existing
non-virtualized version at the end of this task (virtualization is Tasks 3-5).

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/explorer/SearchResults.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isTruncated } from "./SearchResults";
import { SEARCH_RESULT_CAP } from "../stores/useSearchStore";

describe("isTruncated", () => {
  it("is false when result count is below the cap", () => {
    expect(isTruncated(SEARCH_RESULT_CAP - 1)).toBe(false);
  });

  it("is false for zero results", () => {
    expect(isTruncated(0)).toBe(false);
  });

  it("is true when result count equals the cap", () => {
    expect(isTruncated(SEARCH_RESULT_CAP)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npm test -- --run SearchResults`
Expected: FAIL — `SEARCH_RESULT_CAP` isn't exported from `useSearchStore.ts` yet, and
`isTruncated` isn't exported from `SearchResults.tsx` yet.

- [ ] **Step 3: Add the constant to `useSearchStore.ts`**

In `apps/desktop/src/stores/useSearchStore.ts`, add near the top (after the existing imports,
before `export interface SearchFilters`):

```ts
/** Must match crates/search/src/query.rs's SEARCH_RESULT_CAP -- kept as a separate constant
 * because there's no shared-constant mechanism across the Rust/TS boundary in this codebase. */
export const SEARCH_RESULT_CAP = 500;
```

- [ ] **Step 4: Add `isTruncated` and the banner to `SearchResults.tsx`**

In `apps/desktop/src/explorer/SearchResults.tsx`, change the import line:

```ts
import { useExplorerStore } from "../stores/useExplorerStore";
import { useSearchStore } from "../stores/useSearchStore";
import { formatSize, formatModified } from "./FileList";
import "./SearchResults.css";
```

to:

```ts
import { useExplorerStore } from "../stores/useExplorerStore";
import { SEARCH_RESULT_CAP, useSearchStore } from "../stores/useSearchStore";
import { formatSize, formatModified } from "./FileList";
import "./SearchResults.css";

/** True once results hit the cap -- a heuristic, not an exact "there are more" signal (a search
 * that happens to match exactly SEARCH_RESULT_CAP results and no more would also show this),
 * chosen because an exact count would require a second COUNT(*) query on every search, working
 * against the whole point of this cap. */
export function isTruncated(resultCount: number): boolean {
  return resultCount === SEARCH_RESULT_CAP;
}
```

Then change the `if (results.length === 0)` block and the start of the `return` statement:

```tsx
  if (results.length === 0) {
    return <div className="search-results-message">No matches yet — enter a search and press Enter.</div>;
  }

  return (
    <table className="search-results">
```

to:

```tsx
  if (results.length === 0) {
    return <div className="search-results-message">No matches yet — enter a search and press Enter.</div>;
  }

  return (
    <>
      {isTruncated(results.length) && (
        <p className="search-results__truncated-banner">
          ⚠ Showing first {SEARCH_RESULT_CAP} results. Narrow your search to see everything.
        </p>
      )}
      <table className="search-results">
```

And change the closing tag at the end of the component from:

```tsx
      </tbody>
    </table>
  );
}
```

to:

```tsx
      </tbody>
      </table>
    </>
  );
}
```

- [ ] **Step 5: Add the banner's CSS**

Append to `apps/desktop/src/explorer/SearchResults.css`:

```css
.search-results__truncated-banner {
  margin: 0;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--fg-muted);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/desktop && npm test -- --run SearchResults`
Expected: PASS, 3 tests.

- [ ] **Step 7: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/stores/useSearchStore.ts apps/desktop/src/explorer/SearchResults.tsx apps/desktop/src/explorer/SearchResults.css apps/desktop/src/explorer/SearchResults.test.ts
git commit -m "Show a truncation banner when search results hit the cap"
```

---

### Task 3: Extract `SearchResultsTable` (behavior-preserving refactor)

This mirrors Task 3 of the file-list virtualization plan
(`docs/superpowers/plans/2026-07-17-file-list-virtualization.md`): move the existing `<table>`
markup out of `SearchResults.tsx` into its own file, changing nothing about behavior.

**Files:**
- Create: `apps/desktop/src/explorer/SearchResultsTable.tsx`
- Modify: `apps/desktop/src/explorer/SearchResults.tsx`

- [ ] **Step 1: Read the current `SearchResults.tsx`**

Read `apps/desktop/src/explorer/SearchResults.tsx` in full to confirm its exact current content
(it should match Task 2's end state: the `isTruncated` helper, the truncation banner, and the
`<table>` markup, all in one file) before making changes.

- [ ] **Step 2: Create `SearchResultsTable.tsx`**

Create `apps/desktop/src/explorer/SearchResultsTable.tsx` with the table markup moved verbatim,
plus a `parentOf` helper (also moved, since only the table needs it):

```tsx
import { formatModified, formatSize } from "./FileList";
import type { SearchResult } from "../stores/useSearchStore";

export function parentOf(path: string): string {
  const separator = /^[a-zA-Z]:\\/.test(path) ? "\\" : "/";
  const index = path.lastIndexOf(separator);
  return index <= 0 ? path : path.slice(0, index);
}

export interface SearchResultsTableProps {
  results: SearchResult[];
  onOpen: (path: string) => void;
}

function SearchResultsTable({ results, onOpen }: SearchResultsTableProps) {
  return (
    <table className="search-results">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Location</th>
          <th scope="col">Size</th>
          <th scope="col">Modified</th>
        </tr>
      </thead>
      <tbody>
        {results.map((result) => (
          <tr
            key={result.path}
            className="search-results__row"
            tabIndex={0}
            onDoubleClick={() => onOpen(result.path)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(result.path);
            }}
          >
            <td>
              {result.isDir ? "\u{1F4C1} " : "\u{1F4C4} "}
              {result.name}
            </td>
            <td className="search-results__location">{parentOf(result.path)}</td>
            <td>{formatSize(result.size)}</td>
            <td>{formatModified(result.modified ? String(result.modified) : null)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default SearchResultsTable;
```

- [ ] **Step 3: Update `SearchResults.tsx`**

Replace the entire contents of `apps/desktop/src/explorer/SearchResults.tsx` with:

```tsx
import { useExplorerStore } from "../stores/useExplorerStore";
import { SEARCH_RESULT_CAP, useSearchStore } from "../stores/useSearchStore";
import SearchResultsTable, { parentOf } from "./SearchResultsTable";
import "./SearchResults.css";

/** True once results hit the cap -- a heuristic, not an exact "there are more" signal (a search
 * that happens to match exactly SEARCH_RESULT_CAP results and no more would also show this),
 * chosen because an exact count would require a second COUNT(*) query on every search, working
 * against the whole point of this cap. */
export function isTruncated(resultCount: number): boolean {
  return resultCount === SEARCH_RESULT_CAP;
}

function SearchResults() {
  const results = useSearchStore((state) => state.results);
  const loading = useSearchStore((state) => state.loading);
  const error = useSearchStore((state) => state.error);
  const setActive = useSearchStore((state) => state.setActive);
  const navigateTo = useExplorerStore((state) => state.navigateTo);
  const setSelected = useExplorerStore((state) => state.setSelected);

  function openResult(path: string) {
    navigateTo(parentOf(path));
    setSelected(path);
    setActive(false);
  }

  if (error) {
    return <div className="search-results-message search-results-message--error">{error}</div>;
  }

  if (loading) {
    return <div className="search-results-message">Searching…</div>;
  }

  if (results.length === 0) {
    return <div className="search-results-message">No matches yet — enter a search and press Enter.</div>;
  }

  return (
    <>
      {isTruncated(results.length) && (
        <p className="search-results__truncated-banner">
          ⚠ Showing first {SEARCH_RESULT_CAP} results. Narrow your search to see everything.
        </p>
      )}
      <SearchResultsTable results={results} onOpen={openResult} />
    </>
  );
}

export default SearchResults;
```

This removes the old inline `parentOf` function (now imported from `SearchResultsTable.tsx`,
which exports it per Task 3 Step 2) and the old inline `<table>` JSX (now the
`SearchResultsTable` component), while keeping `openResult` and all the loading/error/empty-state
handling exactly as they were.

- [ ] **Step 4: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors; all tests pass (this is a pure refactor, so nothing should break —
`SearchResults.test.ts`'s `isTruncated` tests are unaffected since that function didn't move).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/explorer/SearchResultsTable.tsx apps/desktop/src/explorer/SearchResults.tsx
git commit -m "Extract SearchResultsTable from SearchResults as a standalone component"
```

---

### Task 4: Build `VirtualSearchResults`

**Files:**
- Create: `apps/desktop/src/explorer/VirtualSearchResults.tsx`
- Modify: `apps/desktop/src/explorer/SearchResults.css`

- [ ] **Step 1: Create `VirtualSearchResults.tsx`**

Create `apps/desktop/src/explorer/VirtualSearchResults.tsx`:

```tsx
import { memo, useMemo } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { useElementSize } from "../hooks/useElementSize";
import { formatModified, formatSize } from "./FileList";
import { parentOf } from "./SearchResultsTable";
import type { SearchResult } from "../stores/useSearchStore";

const GRID_TEMPLATE_COLUMNS = "1fr 1fr 90px 170px";

/** Search results have no icon-size setting (unlike the file list), so this is a single fixed
 * height rather than a per-icon-size table like FileList's ROW_HEIGHT_PX. */
const SEARCH_ROW_HEIGHT_PX = 28;

interface RowData {
  results: SearchResult[];
  onOpen: (path: string) => void;
}

const VirtualSearchRow = memo(function VirtualSearchRow({
  index,
  style,
  data,
}: ListChildComponentProps<RowData>) {
  const result = data.results[index];

  return (
    <div
      role="row"
      tabIndex={0}
      style={{ ...style, display: "grid", gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
      className="search-results__row search-results__row--grid"
      onDoubleClick={() => data.onOpen(result.path)}
      onKeyDown={(event) => {
        if (event.key === "Enter") data.onOpen(result.path);
      }}
    >
      <div role="gridcell">
        {result.isDir ? "\u{1F4C1} " : "\u{1F4C4} "}
        {result.name}
      </div>
      <div role="gridcell" className="search-results__location">
        {parentOf(result.path)}
      </div>
      <div role="gridcell">{formatSize(result.size)}</div>
      <div role="gridcell">{formatModified(result.modified ? String(result.modified) : null)}</div>
    </div>
  );
});

export interface VirtualSearchResultsProps {
  results: SearchResult[];
  onOpen: (path: string) => void;
}

function VirtualSearchResults({ results, onOpen }: VirtualSearchResultsProps) {
  const [sizeRef, size] = useElementSize<HTMLDivElement>();

  const itemData = useMemo<RowData>(() => ({ results, onOpen }), [results, onOpen]);

  return (
    <div role="table" className="search-results search-results--virtual">
      <div role="row" className="search-results__header-row" style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}>
        <div role="columnheader">Name</div>
        <div role="columnheader">Location</div>
        <div role="columnheader">Size</div>
        <div role="columnheader">Modified</div>
      </div>
      <div ref={sizeRef} role="rowgroup" className="search-results__virtual-body">
        {size.height > 0 && (
          <FixedSizeList
            height={size.height}
            width={size.width}
            itemCount={results.length}
            itemSize={SEARCH_ROW_HEIGHT_PX}
            itemData={itemData}
            style={{ overflowY: "scroll" }}
          >
            {VirtualSearchRow}
          </FixedSizeList>
        )}
      </div>
    </div>
  );
}

export default VirtualSearchResults;
```

- [ ] **Step 2: Add CSS for the virtualized grid**

Append to `apps/desktop/src/explorer/SearchResults.css`:

```css
.search-results--virtual {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.search-results__header-row {
  display: grid;
  padding: 0;
  padding-right: 17px; /* Matches FixedSizeList's always-reserved vertical scrollbar (same
    reasoning as VirtualFileTable's identical rule in FileList.css) so header columns stay
    aligned with body columns whether or not the list actually needs to scroll. */
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.search-results__header-row [role="columnheader"] {
  padding: 6px 10px;
  color: var(--fg-muted);
  font-size: 13px;
}

.search-results__virtual-body {
  flex: 1;
  min-height: 0;
}

.search-results__row--grid {
  align-items: center;
  box-sizing: border-box;
}

.search-results__row--grid [role="gridcell"] {
  padding: 4px 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors. (`VirtualSearchResults` isn't rendered from anywhere yet, so this only
proves it compiles in isolation — Task 5 wires it in.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/explorer/VirtualSearchResults.tsx apps/desktop/src/explorer/SearchResults.css
git commit -m "Add VirtualSearchResults"
```

---

### Task 5: Wire the threshold branch into `SearchResults` and verify

**Files:**
- Modify: `apps/desktop/src/explorer/SearchResults.tsx`

- [ ] **Step 1: Import the new pieces**

Add to the imports in `apps/desktop/src/explorer/SearchResults.tsx`:

```ts
import VirtualSearchResults from "./VirtualSearchResults";
import { shouldVirtualize } from "./virtualization";
```

- [ ] **Step 2: Branch on the threshold**

Replace `<SearchResultsTable results={results} onOpen={openResult} />` with:

```tsx
{shouldVirtualize(results.length) ? (
  <VirtualSearchResults results={results} onOpen={openResult} />
) : (
  <SearchResultsTable results={results} onOpen={openResult} />
)}
```

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors; all tests pass.

- [ ] **Step 4: Production build**

Run: `cd apps/desktop && npm run build`
Expected: builds successfully.

- [ ] **Step 5: Full workspace verification**

Run: `cargo test --workspace && cd apps/desktop && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: all green.

- [ ] **Step 6: Manual verification (cannot be automated)**

Run the dev build and check:

1. A search returning well under 150 results still renders through the plain table (unchanged
   look and feel) — double-click and Enter-to-open both work per row.
2. A search returning more than 150 but fewer than 500 results renders through
   `VirtualSearchResults` — scrolling is smooth, double-click and Enter-to-open still work,
   column headers stay aligned with body columns while scrolling.
3. A deliberately broad search that would have returned 500+ results before this fix now:
   - Returns quickly (not hanging).
   - Shows the truncation banner ("Showing first 500 results...").
   - Does **not** cause runaway memory growth — check Task Manager / process memory for the
     app's WebView2 renderer process before and after; it should stay in the tens-to-low-hundreds
     of MB range, not climb into the gigabytes.
4. Confirm clearing the search query and running a new, narrower search works correctly and
   doesn't leave stale results or a stuck "Searching…" state.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/explorer/SearchResults.tsx
git commit -m "Wire VirtualSearchResults in above the entry-count threshold"
```
