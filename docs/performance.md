# Performance

Status: partial. `Plan.md`'s targets are reproduced below alongside what's actually been
measured and how, plus one known optimization opportunity found during this pass.

## Targets (from Plan.md)

| Target | Status |
|---|---|
| Startup < 1 second | Not directly measured (see "What couldn't be measured" below) |
| Directory loading < 100ms | Automated regression test, see below |
| Search responsiveness: instant where indexed | Automated regression test, see below — but see "Known optimization opportunity" |
| Memory < 250MB idle | Not directly measured (see "What couldn't be measured" below) |

## What's measured, and how

Two automated tests exist purely to catch a *scaling regression* (an accidental O(n²), a
per-row syscall/commit turned into a loop, etc.) — they're not a certification that the literal
Plan.md numbers hold on every machine, since both assert a looser bound than the target to
avoid flaking on a slower CI runner:

- `crates/filesystem/src/listing.rs` —
  `list_directory_handles_five_thousand_entries_without_a_scaling_regression` creates 5,000
  files in a temp directory and asserts `list_directory` returns in well under 500ms (Plan.md
  target: 100ms). This measures the backend function in isolation, not the full Tauri
  command round-trip (IPC serialization, frontend render) a real "directory loading" number
  would include.
- `crates/search/src/query.rs` — `search_scales_to_five_thousand_indexed_entries` inserts 5,000
  rows directly via SQL (bypassing the filesystem walk, which `build_index`'s own tests cover
  separately) and asserts a filtered `search()` call returns in well under 200ms. The existing
  `(root, name)` index (`crates/search/src/db.rs`) is what keeps this fast; the test exists to
  catch a future filter that accidentally can't use that index (e.g. wrapping `name` in a
  function in the `WHERE` clause) and falls back to a full table scan.

Run them with `cargo test -p explorer-filesystem -p explorer-search`.

## What couldn't be measured

Startup time and idle memory both require launching and observing the actual windowed Tauri
app — this project operates under a standing "no manual GUI testing" constraint (an earlier
session's search-indexer hang made a launch-and-watch workflow costly), so neither was measured
end-to-end. What a code review can say instead:

- **Startup**: `App.tsx` renders a "Loading…" screen immediately on mount, then kicks off
  settings load, plugin load (gated on settings load — see `App.tsx`'s comment on that
  ordering), and initial tab bootstrap in parallel `useEffect`s. None of this blocks the first
  paint. Actual wall-clock startup is dominated by native window creation and WebView2
  initialization, which aren't things application code controls.
- **Idle memory**: no polling (`setInterval`) exists anywhere in the frontend — the only
  `setTimeout` usage is the toast auto-dismiss (6s, one-shot) and a search-history blur delay
  (150ms, one-shot). No store holds unbounded state (search results/history are bounded by
  backend query limits; toasts self-remove). Each Tauri command that touches SQLite
  (`crates/search/src/db.rs`) opens a fresh `Connection` per call rather than holding a pool
  open, so nothing stays resident between calls. The dominant idle-memory cost is almost
  certainly WebView2's own baseline footprint, which is outside application code's control.

If you want real numbers for these two, the lowest-risk way to get them without violating the
no-manual-testing constraint would be a short, explicitly-approved one-off session where you
(not me) launch the built app and check Task Manager / a startup timer — I can prep the release
build for that but shouldn't be the one driving the GUI.

## Known optimization opportunity: search re-indexes on every query

`apps/desktop/src-tauri/src/commands.rs`'s `search_files` command calls
`explorer_search::build_index(&root, None)` — a full recursive filesystem walk — **before**
every single search, unconditionally. This means "search responsiveness: instant where indexed"
doesn't currently hold for a folder with many files: every search pays the full walk cost, not
just the first one.

This looks like a deliberate freshness-over-speed tradeoff (an index that might be stale is
arguably worse than a slow one), not an oversight — the Phase 4 tests were written assuming
`search` always follows a fresh `build_index`. Changing it to "only rebuild if missing/stale"
would improve repeat-search latency significantly but introduces a staleness question (how does
a rebuild get triggered when files change?) that's a product decision, not a pure performance
one. Flagging it here rather than changing it unilaterally.
