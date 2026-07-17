# Search Results Memory Fix — Design

## Goal

A single broad search (e.g. searching for a common one-letter substring over a large home
directory) can return an effectively unbounded result set. `crates/search/src/query.rs`'s
`search()` has no `LIMIT`, and `SearchResults.tsx` renders every result as a real `<table>` row
via a plain `.map()` — no windowing at all. In manual testing, one such search drove a WebView2
renderer process to over 9GB of memory, and the app became unresponsive enough to require killing
the process to recover. Fix this with defense in depth: cap the result set at the source, and
virtualize the rendering so even the capped size stays cheap.

## Backend: hard result cap

`crates/search/src/query.rs` gains a `pub const SEARCH_RESULT_CAP: usize = 500;` and the SQL
query in `search()` gets a `LIMIT ?` clause appended after the existing `ORDER BY is_dir DESC,
name COLLATE NOCASE ASC`, bound as a parameter (not string-interpolated) using
`SEARCH_RESULT_CAP` cast to `i64`. This applies regardless of filters — every call to `search()`
is capped, not just unfiltered ones.

500 was chosen as generous enough to cover real search intent (search results in the many
hundreds usually mean the query needs narrowing, not that the user wants to scroll through all of
them) while keeping worst-case IPC payload and render cost small.

No `COUNT(*)` query is added to report an exact total — that would double query cost on every
search (even ones well under the cap) to serve a rarely-needed exact number. The frontend infers
"possibly truncated" from `results.length === SEARCH_RESULT_CAP` instead (see below).

## Frontend: truncation banner

`apps/desktop/src/stores/useSearchStore.ts` gains a matching constant:

```ts
/** Must match crates/search/src/query.rs's SEARCH_RESULT_CAP -- kept as a separate constant
 * because there's no shared-constant mechanism across the Rust/TS boundary in this codebase. */
export const SEARCH_RESULT_CAP = 500;
```

`SearchResults.tsx` shows a small warning banner above the results whenever
`results.length === SEARCH_RESULT_CAP`:

> ⚠ Showing first 500 results. Narrow your search to see everything.

This is a heuristic, not an exact "truncated" signal (a search that happens to match exactly 500
results and no more would show the banner unnecessarily) — an acceptable, clearly-labeled
imprecision given the alternative (an extra COUNT query on every search) works against the
performance goal this whole fix exists for.

## Frontend: virtualization

Reuses the existing `apps/desktop/src/explorer/virtualization.ts` module as-is —
`VIRTUALIZATION_THRESHOLD` (150) and `shouldVirtualize(count)` — no changes needed there.

`SearchResults.tsx` becomes the state/logic owner, mirroring the role `FileList.tsx` plays for
the file list: it keeps the loading/error/empty-state handling and the truncation banner, and
renders one of two sibling presentational components based on `shouldVirtualize(results.length)`:

- **`SearchResultsTable`** (new file) — the existing `<table>` markup extracted verbatim, used at
  or below 150 results.
- **`VirtualSearchResults`** (new file) — a `react-window`-backed virtualized alternative, used
  above 150 results (i.e. whenever the truncation banner is showing, since 150 < 500).

`VirtualSearchResults` is simpler than `VirtualFileTable` (the file list's virtualized
component): search result rows only support double-click and Enter to open (no drag-and-drop, no
inline rename, no context menu, no per-row selection state) — so it's a straightforward
`FixedSizeList` with CSS Grid rows and a single fixed row height constant (search results don't
respect the file list's icon-size setting, so there's no per-icon-size row-height table like
`ROW_HEIGHT_PX`, just one `SEARCH_ROW_HEIGHT_PX` constant).

```
SearchResults (state: results, loading, error, banner; owns the threshold decision)
├─ results.length <= 150 → SearchResultsTable (today's table markup, extracted verbatim)
└─ results.length > 150  → VirtualSearchResults (new, react-window)
```

Column layout mirrors the existing table's four columns (Name, Location, Size, Modified) via a
`grid-template-columns` matching their approximate proportions, following the same pattern
established for `VirtualFileTable` (including the same scrollbar-width header-alignment fix
applied there, reused verbatim since it's not specific to the file list).

## Testing

- `SEARCH_RESULT_CAP` enforcement: a Rust test seeds more than 500 matching rows and asserts
  `search()` returns exactly 500.
- The truncation-banner condition and `shouldVirtualize` reuse: pure-logic, unit-tested the same
  way `virtualization.test.ts` already covers the file list's threshold.
- Actual virtualized-scrolling behavior against a real broad search: verified by hand, the same
  way the file list's virtualization was — this codebase has no established pattern for
  automated interactive-component testing.

## Out of scope

- An exact "N of M total" truncation count (explicitly rejected above — costs an extra query).
- Raising or lowering `VIRTUALIZATION_THRESHOLD` itself (unchanged, shared with the file list).
- Any change to how the search index is built or queried beyond adding the `LIMIT`.
- Per-row interactions beyond open (selection, drag, rename, context menu) — search results have
  never supported these, and this fix doesn't add them.
