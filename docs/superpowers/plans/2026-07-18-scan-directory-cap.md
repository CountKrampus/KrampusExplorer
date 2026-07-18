# scanDirectory Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a real, reported bug — the "Disk Usage Visualizer" plugin froze the app for about a
minute because `scanDirectory` has no cap and returns an unbounded result set. Cap it at the
source (mirroring the recent search-results memory fix) and add a truncation notice to both
plugins that call it.

**Architecture:** `scan_directory` in `crates/plugins/src/scan.rs` gets a hard cap, refactored
into a public `scan_directory` (unchanged signature) delegating to a private, testable
`scan_directory_capped(root, cap)`. No Tauri command or plugin API shape change — callers infer
truncation from `files.length === SCAN_FILE_CAP`, the same heuristic the search fix uses.

**Tech Stack:** Rust, plain JS (example plugin entry files, no build step).

Full design: `docs/superpowers/specs/2026-07-18-scan-directory-cap-design.md`.

---

### Task 1: Backend cap

**Files:**
- Modify: `crates/plugins/src/scan.rs`

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `crates/plugins/src/scan.rs` (after the existing
`scan_directory_returns_empty_for_an_empty_folder` test):

```rust
    #[test]
    fn scan_directory_caps_results_at_the_given_limit() {
        let dir = tempdir().unwrap();
        for i in 0..10 {
            fs::write(dir.path().join(format!("file_{i}.txt")), b"x").unwrap();
        }

        let files = scan_directory_capped(dir.path().to_str().unwrap(), 5).unwrap();

        assert_eq!(files.len(), 5);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p explorer-plugins scan_directory_caps_results_at_the_given_limit`
Expected: FAIL — `scan_directory_capped` doesn't exist yet.

- [ ] **Step 3: Refactor `scan_directory` into a capped implementation**

In `crates/plugins/src/scan.rs`, add near the top of the file (after the existing `use`
statements, before the `ScannedFile` struct):

```rust
/// Hard cap on the number of files a single scan_directory() call can return. Without this, a
/// recursive walk of a large root (a whole drive commonly has 200k-1M+ files) returns an
/// effectively unbounded result set -- in a real bug report, this froze the app for about a
/// minute (a slow Rust-side walk, a huge IPC payload, then a synchronous JS loop over the whole
/// array). 50,000 keeps worst-case payload/processing time bounded while staying generous for
/// legitimate large-folder analysis. Any plugin frontend calling `scanDirectory` should treat a
/// result of exactly this length as "possibly truncated, more may exist" -- see
/// examples/plugins/disk-usage-visualizer/frontend/index.js and
/// examples/plugins/duplicate-finder/frontend/index.js's matching `SCAN_FILE_CAP` constants.
pub const SCAN_FILE_CAP: usize = 50_000;
```

Then change:

```rust
pub fn scan_directory(root: &str) -> Result<Vec<ScannedFile>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("'{root}' is not a directory"));
    }
    let mut results = Vec::new();
    walk(root_path, &mut results);
    Ok(results)
}

fn walk(dir: &Path, results: &mut Vec<ScannedFile>) {
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            walk(&path, results);
        } else if file_type.is_file() {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            results.push(ScannedFile {
                path: path.to_string_lossy().to_string(),
                size,
            });
        }
    }
}
```

to:

```rust
pub fn scan_directory(root: &str) -> Result<Vec<ScannedFile>, String> {
    scan_directory_capped(root, SCAN_FILE_CAP)
}

fn scan_directory_capped(root: &str, cap: usize) -> Result<Vec<ScannedFile>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("'{root}' is not a directory"));
    }
    let mut results = Vec::new();
    walk(root_path, &mut results, cap);
    Ok(results)
}

fn walk(dir: &Path, results: &mut Vec<ScannedFile>, cap: usize) {
    if results.len() >= cap {
        return;
    }
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        if results.len() >= cap {
            return;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            walk(&path, results, cap);
        } else if file_type.is_file() {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            results.push(ScannedFile {
                path: path.to_string_lossy().to_string(),
                size,
            });
        }
    }
}
```

(The cap is checked both at the top of `walk` — so a call that's already at the cap doesn't even
open the directory — and inside the loop after each iteration, so a nested recursive call hitting
the cap partway through a directory's entries stops the outer loop too, rather than continuing to
iterate remaining siblings before the next top-of-function check would catch it.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p explorer-plugins scan_directory_caps_results_at_the_given_limit`
Expected: PASS.

- [ ] **Step 5: Run the full plugins crate test suite**

Run: `cargo test -p explorer-plugins`
Expected: all tests pass, including the pre-existing `scan_directory_finds_nested_files_with_sizes`
and `scan_directory_returns_empty_for_an_empty_folder` (both well under any cap, unaffected) and
`scan_directory_errors_on_missing_path` (error path unchanged).

- [ ] **Step 6: Commit**

```bash
git add crates/plugins/src/scan.rs
git commit -m "Cap scan_directory at 50,000 files to prevent unbounded memory/CPU use"
```

---

### Task 2: Truncation notice in disk-usage-visualizer

**Files:**
- Modify: `examples/plugins/disk-usage-visualizer/frontend/index.js`

- [ ] **Step 1: Add the matching cap constant**

In `examples/plugins/disk-usage-visualizer/frontend/index.js`, change:

```js
function formatSize(bytes) {
```

to:

```js
/** Must match crates/plugins/src/scan.rs's SCAN_FILE_CAP. */
const SCAN_FILE_CAP = 50000;

function formatSize(bytes) {
```

- [ ] **Step 2: Show the notice when the scan hit the cap**

Change:

```js
        const entries = [...bySegment.entries()].sort((a, b) => b[1] - a[1]);
        setStatus(`${formatSize(total)} total across ${entries.length} item${entries.length === 1 ? "" : "s"}`, false);
```

to:

```js
        const entries = [...bySegment.entries()].sort((a, b) => b[1] - a[1]);
        const truncatedNote =
          files.length === SCAN_FILE_CAP
            ? ` (scanned first ${SCAN_FILE_CAP.toLocaleString()} files -- results may be incomplete, try a narrower folder)`
            : "";
        setStatus(
          `${formatSize(total)} total across ${entries.length} item${entries.length === 1 ? "" : "s"}${truncatedNote}`,
          false,
        );
```

- [ ] **Step 3: Read the file back to confirm it's well-formed**

Read `examples/plugins/disk-usage-visualizer/frontend/index.js` in full and confirm the edit
produced valid JS (this file has no build step or test suite — it's loaded at runtime via
`new Function`, so a syntax error would only surface when someone opens the plugin panel).

- [ ] **Step 4: Commit**

```bash
git add examples/plugins/disk-usage-visualizer/frontend/index.js
git commit -m "Show a truncation notice in Disk Usage Visualizer when a scan hits the cap"
```

---

### Task 3: Truncation notice in duplicate-finder

**Files:**
- Modify: `examples/plugins/duplicate-finder/frontend/index.js`

- [ ] **Step 1: Add the matching cap constant**

In `examples/plugins/duplicate-finder/frontend/index.js`, change:

```js
const MAX_CANDIDATES = 20000;
const HASH_CHUNK_SIZE = 1000;
```

to:

```js
const MAX_CANDIDATES = 20000;
const HASH_CHUNK_SIZE = 1000;
/** Must match crates/plugins/src/scan.rs's SCAN_FILE_CAP. */
const SCAN_FILE_CAP = 50000;
```

- [ ] **Step 2: Thread a truncation suffix through `renderGroups`**

Change:

```js
    function renderGroups(groups) {
      results.innerHTML = "";
      if (groups.length === 0) {
        setStatus("No duplicates found.", false);
        return;
      }
      const totalWasted = groups.reduce((sum, g) => sum + g.size * (g.paths.length - 1), 0);
      setStatus(
        `${groups.length} duplicate group${groups.length === 1 ? "" : "s"} — ${formatSize(totalWasted)} wasted`,
        false,
      );
```

to:

```js
    function renderGroups(groups, truncatedNote) {
      results.innerHTML = "";
      if (groups.length === 0) {
        setStatus(`No duplicates found.${truncatedNote}`, false);
        return;
      }
      const totalWasted = groups.reduce((sum, g) => sum + g.size * (g.paths.length - 1), 0);
      setStatus(
        `${groups.length} duplicate group${groups.length === 1 ? "" : "s"} — ${formatSize(totalWasted)} wasted${truncatedNote}`,
        false,
      );
```

- [ ] **Step 3: Compute the note and pass it at every call site**

Change:

```js
      try {
        const files = await api.scanDirectory(root);

        // Group by size first — hashing every file would be wasteful when most files have a
        // unique size and therefore can't possibly be duplicates of anything.
        const bySize = new Map();
        for (const file of files) {
          const bucket = bySize.get(file.size);
          if (bucket) bucket.push(file);
          else bySize.set(file.size, [file]);
        }
        const candidates = [];
        for (const bucket of bySize.values()) {
          if (bucket.length > 1) candidates.push(...bucket);
        }

        if (candidates.length === 0) {
          renderGroups([]);
          return;
        }

        if (candidates.length > MAX_CANDIDATES) {
          setStatus(
            `Found ${candidates.length} same-size candidates — that's too many to hash in one folder ` +
              `(limit ${MAX_CANDIDATES}). Try scanning a narrower folder instead of a whole drive.`,
            true,
          );
          return;
        }
```

to:

```js
      try {
        const files = await api.scanDirectory(root);
        const truncatedNote =
          files.length === SCAN_FILE_CAP
            ? ` (scanned first ${SCAN_FILE_CAP.toLocaleString()} files -- results may be incomplete, try a narrower folder)`
            : "";

        // Group by size first — hashing every file would be wasteful when most files have a
        // unique size and therefore can't possibly be duplicates of anything.
        const bySize = new Map();
        for (const file of files) {
          const bucket = bySize.get(file.size);
          if (bucket) bucket.push(file);
          else bySize.set(file.size, [file]);
        }
        const candidates = [];
        for (const bucket of bySize.values()) {
          if (bucket.length > 1) candidates.push(...bucket);
        }

        if (candidates.length === 0) {
          renderGroups([], truncatedNote);
          return;
        }

        if (candidates.length > MAX_CANDIDATES) {
          setStatus(
            `Found ${candidates.length} same-size candidates — that's too many to hash in one folder ` +
              `(limit ${MAX_CANDIDATES}). Try scanning a narrower folder instead of a whole drive.${truncatedNote}`,
            true,
          );
          return;
        }
```

- [ ] **Step 4: Update the final `renderGroups` call**

Change:

```js
        renderGroups(groups);
```

to:

```js
        renderGroups(groups, truncatedNote);
```

- [ ] **Step 5: Read the file back to confirm it's well-formed**

Read `examples/plugins/duplicate-finder/frontend/index.js` in full and confirm the edit produced
valid JS, and that `renderGroups` is called with two arguments at all three call sites (the
`candidates.length === 0` branch, the final success path — note the `candidates.length >
MAX_CANDIDATES` branch does NOT call `renderGroups` at all, it calls `setStatus` directly, so
only two of the three early-return-style branches actually call `renderGroups`).

- [ ] **Step 6: Commit**

```bash
git add examples/plugins/duplicate-finder/frontend/index.js
git commit -m "Show a truncation notice in Duplicate Finder when a scan hits the cap"
```

---

### Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full Rust workspace verification**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: fmt makes no unexpected changes beyond this plan's own edits, clippy is clean, all
tests pass.

- [ ] **Step 2: Full frontend verification**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: all green. (Nothing in `apps/desktop/src` changed in this plan — this just confirms the
Rust-side change didn't somehow affect the frontend build, e.g. via a changed generated type.)

- [ ] **Step 3: Manual verification (cannot be automated)**

Both changed files are example-plugin JS with no build step or automated test coverage. Verify
by hand against the running dev build:

1. Open the Disk Usage Visualizer plugin panel (install it from the marketplace or sync it from
   `examples/plugins/` if not already installed), point it at a folder with well under 50,000
   files, and confirm the status line shows the normal `"X total across Y items"` message with no
   truncation note.
2. Point it at a folder likely to exceed 50,000 files (a whole drive, or a large `node_modules`
   tree) and confirm: the app does **not** freeze for an extended period, the scan completes, and
   the status line shows the truncation note ("scanned first 50,000 files...").
3. Repeat both checks for the Duplicate Finder plugin — a small folder shows no truncation note
   in its status line; a folder likely to exceed 50,000 files shows the truncation note appended
   to whichever status message it would otherwise show (either the `MAX_CANDIDATES` message or
   the final duplicate-groups summary, depending on how many same-size candidates turn up).

- [ ] **Step 4: Report any failures as real bugs to fix**, not to note-and-move-past — this task
  exists specifically to close out a reported freeze, so if the freeze still reproduces, the fix
  is incomplete.
