# scanDirectory Cap — Design

## Goal

The user reported that the "Disk Usage Visualizer" plugin froze the whole app for about a
minute before recovering. Root cause: `crates/plugins/src/scan.rs`'s `scan_directory` does a
fully synchronous, unbounded recursive filesystem walk with no cap, returning the entire result
set as one array over IPC. Pointed at a large root (a whole drive commonly has 200k-1M+ files),
this means a slow Rust-side walk, a huge JSON payload over IPC, and then a synchronous JS loop
over the whole array — all before the frontend gets a chance to do anything about it. The
`duplicate-finder` plugin has the identical exposure: it caps how many same-size *candidates* it
will hash (`MAX_CANDIDATES = 20000`), but the initial `scanDirectory` call that produces those
candidates is just as unbounded as disk-usage-visualizer's.

This is the same class of bug as the recent search-results memory fix (unbounded backend
operation, unbounded IPC payload) — the same fix shape applies: a hard cap at the source.

## Backend: hard cap, no API shape change

`crates/plugins/src/scan.rs` gains:

```rust
pub const SCAN_FILE_CAP: usize = 50_000;
```

`walk()` stops collecting once `results.len()` reaches `SCAN_FILE_CAP` — it returns whatever it
has gathered so far rather than continuing to recurse. Because this is a depth-first walk with no
sorting, *which* 50,000 files land in a capped result is traversal-order-dependent, not a
deterministic "first 50,000 alphabetically" — acceptable given the goal is an approximate picture
to prompt narrowing the scan, not a guaranteed-complete accounting (the same reasoning the search
truncation banner already uses).

Unlike the search fix, this does **not** change `scan_directory`'s return type — it stays
`Result<Vec<ScannedFile>, String>`, a plain array, no `{ files, truncated }` wrapper. This avoids
any breaking change to the `fs.scan` plugin API's `scanDirectory` return shape
(`Promise<ScannedFile[]>` in `pluginApi.ts`), which matters because plugin entry files are loaded
as opaque `new Function` code with no version negotiation — a shape change would break any
existing plugin using `fs.scan`, first-party or otherwise. Instead, callers infer truncation the
same way the search fix's frontend does: `files.length === SCAN_FILE_CAP` implies "there may be
more."

50,000 was chosen to keep worst-case IPC payload and processing time bounded to something that
won't visibly freeze the UI (each `ScannedFile` is a path string + a `u64` size — 50k entries is
low tens of MB even for long paths) while still being generous enough for legitimate large-folder
analysis (a folder with under 50,000 files, the common case, is completely unaffected).

## Frontend: matching constant + truncation notice, both plugins

`examples/plugins/disk-usage-visualizer/frontend/index.js` and
`examples/plugins/duplicate-finder/frontend/index.js` each gain:

```js
/** Must match crates/plugins/src/scan.rs's SCAN_FILE_CAP. */
const SCAN_FILE_CAP = 50000;
```

and check `files.length === SCAN_FILE_CAP` after the `scanDirectory` call, showing a status
message when true:

> Scanned first 50,000 files — results may be incomplete. Try a narrower folder for a complete
> picture.

For `disk-usage-visualizer`, this is a straightforward addition to its existing `setStatus` call
after the scan. For `duplicate-finder`, the truncation notice needs to compose with its existing
`MAX_CANDIDATES` check (which operates on same-size candidates *after* the scan, a separate,
already-existing guard) — both messages can be shown if both conditions are true, since they
describe different, independent kinds of incompleteness (the scan itself was cut off, versus too
many candidates to hash).

## Testing

- A Rust test seeds more than `SCAN_FILE_CAP` files in a temp directory and asserts
  `scan_directory` returns exactly `SCAN_FILE_CAP` entries, not more.
- The two plugin frontend files are untested by this codebase's existing conventions (example
  plugin code loaded via `new Function`, not imported/built — see the existing example plugins,
  none of which have test files) — verified by hand instead, consistent with how the terminal
  and other plugin UI work was verified earlier.

## Out of scope

- Any progress reporting / streaming / cancellation for an in-progress scan (a materially bigger
  change to the `fs.scan` API surface than this fix's goal).
- Raising `MAX_CANDIDATES` or changing duplicate-finder's hashing-phase cap logic — untouched.
- Any change to `hash_files`' existing chunking (already correctly bounded, not part of this bug).
