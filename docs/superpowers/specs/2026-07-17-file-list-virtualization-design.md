# File List Virtualization — Design

## Goal

`FileList.tsx` renders every entry in the current folder as a real `<tr>` DOM node. For a folder
with thousands of files, that's a slow initial paint and janky scrolling — no windowing at all.
Add virtualization so only the rows actually visible on screen exist in the DOM, without
regressing the current, already-well-tested behavior for the common case of small/typical
folders.

## Why a threshold instead of always-virtualized

Two ways to activate virtualization:

1. **Threshold-based** — folders at or below some entry count keep rendering through today's
   exact `<table>` code path, untouched. Only folders above the threshold render through a new
   virtualized path.
2. **Always virtualized** — one code path for every folder size.

This project is going with **threshold-based**. The vast majority of real folder browsing is
well under a thousand entries, where the current table already performs fine and is already
covered by existing tests and real-world use. Keeping that path completely untouched means the
new, more complex virtualized code is additive risk confined to the large-folder case, not a
rewrite of the common case. The cost is two render paths to keep visually consistent instead of
one, which the shared-state architecture below is designed to minimize.

**Threshold: 150 entries.** Comfortably above where the current table is smooth, comfortably
below where un-virtualized rendering starts to visibly hurt.

## Architecture

`FileList` (the existing top-level component) keeps owning all shared state and logic exactly as
it does today: sorting (`sortedEntries`), selection, the keyboard handler, drag-and-drop state,
rename state, and the context menu. It renders one of two sibling presentational components
based on `sortedEntries.length`:

- **`FileTable`** (extracted from `FileList`'s current JSX, otherwise unchanged) — the existing
  `<table>`/`<thead>`/`<tbody>`/`<tr>`/`<td>` markup and the existing `FileRow` component, used
  when `sortedEntries.length <= 150`.
- **`VirtualFileTable`** (new) — a `react-window`-backed virtualized render of the same rows,
  used when `sortedEntries.length > 150`.

Neither table component owns state; both receive the same props from `FileList` (entries,
selection set, drag-over path, renaming path/value, every callback). This keeps the two render
paths sharing one source of truth and one set of interaction handlers, so behavior (what happens
on click, drag, rename, etc.) can't drift between them — only the DOM structure and rendering
strategy differ.

```
FileList (state + logic, unchanged)
├─ sortedEntries.length <= 150 → FileTable (today's table markup, unchanged)
└─ sortedEntries.length > 150  → VirtualFileTable (new, react-window)
```

## Markup for `VirtualFileTable`

`react-window`'s `FixedSizeList` absolutely-positions each rendered row via inline `style`,
which doesn't work with native `<table>` layout (a browser lays out table columns based on all
rows being present in the DOM at once — an absolutely-positioned `<tr>` breaks that). So
`VirtualFileTable` uses a CSS Grid structure styled to look identical to the table:

```html
<div role="table" class="file-list file-list--virtual">
  <div role="rowgroup"> <!-- react-window's List, virtualized -->
    <div role="row" style="display:grid; grid-template-columns: 1fr 100px 120px 160px; ...">
      <div role="gridcell">📄 name.txt</div>
      <div role="gridcell">4 KB</div>
      <div role="gridcell">txt</div>
      <div role="gridcell">7/17/2026, 9:40 AM</div>
    </div>
    <!-- more rows, only the visible + overscan range actually rendered -->
  </div>
</div>
```

`grid-template-columns` uses the same four proportions as the current table's four columns
(Name/Size/Type/Modified), so the two render paths look pixel-identical when a folder's entry
count crosses the threshold (e.g. after a filter or as files are added/removed). The header row
(`<thead>`-equivalent) stays a plain, non-virtualized, sticky row in both paths — only the body
rows are virtualized.

ARIA roles (`table`/`rowgroup`/`row`/`gridcell`) replace real `<table>` semantics so screen
readers still get equivalent structure.

## Row height

Today, row height is whatever the browser computes from `<td>` padding + font-size per the
`iconSize` setting (small/medium/large) — there's no fixed pixel value anywhere. `FixedSizeList`
requires one. New constants:

```ts
const ROW_HEIGHT_PX: Record<IconSize, number> = { small: 24, medium: 28, large: 36 };
```

(Exact values tuned during implementation to visually match the current table's computed row
height at each icon size, so crossing the threshold doesn't visibly jump.) `VirtualFileTable`
uses `ROW_HEIGHT_PX[iconSize]` as `itemSize`; the CSS Grid row's own height is set to match via
inline style so the two stay locked together.

## Keyboard navigation across the virtualization boundary

Today, arrow-key navigation (`handleRowKeyDown` in `FileList`) calls
`rowRefs.current.get(path)?.focus()` directly — every row is always in the DOM, so this always
works. Under virtualization, the target row may not be rendered yet. New flow for the virtualized
path only:

1. Arrow-key handler computes the target row's index (same as today).
2. If `rowRefs.current` already has that path (it's currently rendered), focus it directly — no
   change from today.
3. If not, set a `pendingFocusPathRef` to the target path, then call the `FixedSizeList` ref's
   imperative `scrollToItem(index)` to bring it into the rendered window.
4. The virtualized row component's mount/update effect checks `pendingFocusPathRef` on every
   render; if its own path matches, it calls `.focus()` and clears the ref.

This adds a small amount of indirection only to the virtualized path — `FileTable`'s keyboard
handling is untouched.

## Drag-and-drop, rename, context menu

Unaffected by which table is rendering — these are all per-row interactions driven by the same
callback props `FileList` already passes down today (`onDragStart`, `onRenameCommit`,
`onContextMenu`, etc.). `VirtualFileTable`'s row component wires the same callbacks to the same
events, just on `<div>`s instead of `<tr>`/`<td>`s.

## New dependency

`react-window` (~3KB gzipped) — purpose-built, widely used, fixed-height-row virtualization.
Compatible with React 18 (already in use here). Chosen over a hand-rolled virtualizer to avoid
reinventing scroll-position math, resize handling, and overscan tuning, all of which are easy to
get subtly wrong.

## Testing

This codebase's existing `FileList.test.ts` only covers pure helper functions
(`formatSize`/`formatModified`/`sortEntries`), not full component rendering/interaction — there's
no established pattern here for testing interactive component behavior with something like
Testing Library. Following that same pattern:

- Pure-logic additions (the threshold decision, `ROW_HEIGHT_PX` lookup, the pending-focus-index
  resolution logic) get unit tests, same style as the existing `sortEntries` tests.
- Full interactive virtualized-scrolling behavior (does scrolling actually stay smooth on a real
  50k-entry folder, does keyboard nav actually scroll+focus correctly) is verified by hand
  against a real large folder, the same way UI-heavy work has been verified elsewhere this
  session — not something a unit test meaningfully proves.

## Out of scope

- Column resizing or reordering (doesn't exist in the current table either).
- Variable row heights (every row is the same height today; that's not changing).
- Virtualizing anything other than the file list body — the header row, toolbar, context menu,
  and confirm dialog are unaffected.
- Changing the 150-entry threshold based on measured performance data (150 is a reasonable
  starting point, not a tuned value from profiling).
