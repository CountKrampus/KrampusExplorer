# Recover Lost Data Plugin — Design

## Goal

Let a plugin recover files that were deleted outside the Recycle Bin (Shift+Delete, or an emptied
bin) by scanning a drive's raw bytes for recognizable file signatures and extracting matches.
Third of five requested plugins, and a fundamentally different kind of build from the first two
(Recycling Bin, Clear Unnecessary Files) — those wrapped existing safe, high-level OS APIs; this
one does raw disk I/O, requires Administrator elevation, and needs new backend infrastructure that
doesn't fit the "generic Rust primitive + all logic in plugin JS" pattern the earlier plugins used.

## Scope: signature-based file carving

By the time a file is gone from the Recycle Bin, the filesystem has generally stopped tracking it
as a real file — only as space that's free to be reused. Real recovery requires either parsing
filesystem-specific structures (NTFS's Master File Table, which only works on NTFS and needs a new
NTFS-parsing dependency) or scanning raw bytes for file signatures regardless of filesystem
(what tools like PhotoRec do). This design uses the latter — it works on any filesystem, including
a FAT32/exFAT USB stick, at the cost of losing original filenames/folder structure and being
probabilistic (a match only succeeds if the file's data hasn't been overwritten by something else
since deletion).

**v1 file types:** JPEG (`FFD8FF` start, `FFD9` end marker), PNG (8-byte magic start, `IEND` chunk
end marker), PDF (`%PDF` start, `%%EOF` end marker), ZIP (`PK\x03\x04` start — this also covers
DOCX/XLSX/PPTX, which are ZIP containers internally), and MP3 (`ID3` tag or an MPEG frame-sync
byte pattern as start). ZIP and MP3 have no reliably-detectable end marker in the general case, so
both are simply capped at a fixed max size per type and truncated there — a known, accepted
limitation of signature carving that real tools share, not a bug to "fix" in v1.

**The scan is read-only on the source drive.** There's no data-loss risk from running it, unlike
Clear Unnecessary Files or the later Drive Format/Secure Wipe plugins — the only real consequences
are disk space used by recovered files at the destination and the time a full scan takes.

## Elevation and process model

Opening a volume for raw sector-level read access (`\\.\D:`, not normal file APIs) requires
Administrator rights on Windows. This codebase already has the exact relaunch pattern needed, in
`crates/terminal/src/elevation.rs`'s `relaunch_elevated_terminal`: `ShellExecuteW` with the
`"runas"` verb relaunches the app's own executable elevated, passing a command-line flag that
`main.rs` parses to branch into a different entry point (see `parse_elevated_terminal_args` /
`run_elevated_terminal`).

This design adds a new flag, `--recovery-scan`, parsed the same way (with matching unit tests,
mirroring `parse_elevated_terminal_args`'s existing test style), carrying the scan parameters:
`--drive=D:`, `--dest=<path>`, `--types=jpeg,png,pdf,zip,mp3`, `--result-file=<path>`. Unlike the
elevated terminal (which opens a second full window), the relaunched recovery-scan process is
**headless** — no Tauri, no window, no webview. `krampus_explorer_lib::run_recovery_scan(...)`
just runs the scan directly and exits when done or on error.

Progress and results flow back to the original (unelevated) app not through any live IPC channel
between the two separate OS processes, but through a JSON file at `--result-file=<path>` (under
`std::env::temp_dir()`, named with a scan id unique per run) that the elevated process writes to
periodically as it scans, and that the original app's plugin polls roughly once a second via a
normal Tauri command until the file reports `"completed"` or `"failed"`. This is simpler than a
real cross-process IPC channel and fine for this use case — the UI only needs to be "as fresh as
the last poll," not instant.

## New crate: `crates/recovery`

Split deliberately for testability, since most of this plugin's logic is inherently hard to test
(real disk I/O, real elevation) but the actual signature-matching logic doesn't have to be:

- **`signatures.rs`** — pure functions operating on `&[u8]` byte slices with no I/O: given a chunk
  of bytes, find every offset where one of the five signatures' start marker appears; given a
  byte slice starting at a detected signature, find (or cap) where that file type's data ends.
  Fully unit-testable with hand-built byte arrays embedding known signatures — no real disk or
  admin rights needed.
- **`progress.rs`** — a `RecoveryProgress` struct (`status: Running | Completed | Failed`,
  `bytes_scanned: u64`, `total_bytes: u64`, `files_found_by_type: HashMap<String, u32>`,
  `error: Option<String>`) serialized to/from a JSON file. Unit-testable with a real temp file
  (via the `tempfile` dev-dependency already used elsewhere in this workspace) — no admin rights
  needed, just normal file I/O.
- **`scan.rs`** — orchestrates the real thing: opens the raw volume, reads it in overlapping fixed
  chunks (overlap sized to the largest per-type start-marker length, so a signature straddling a
  chunk boundary isn't missed), calls into `signatures.rs` for detection, writes matched/extracted
  data into the destination folder, and periodically writes progress via `progress.rs`. This part
  gets no automated tests, matching the established precedent for code that necessarily touches
  real, privileged OS state (`delete_entry`, the Recycling Bin plugin's trash functions) —
  verified by hand instead (see Testing below).
- **`elevation.rs`** — `relaunch_recovery_scan(drive, destination, file_types)`, mirroring
  `crates/terminal/src/elevation.rs`'s `relaunch_elevated_terminal` (same `ShellExecuteW`/`runas`
  approach, new flag/arguments). No automated tests, matching that file's own precedent (its one
  test, `is_elevated_is_false_under_a_normal_test_run`, is a smoke test, not a full correctness
  proof — the same standard applies here).

Destination output layout: type-based subfolders with numbered names —
`<destination>/jpeg/recovered_0001.jpg`, `<destination>/pdf/recovered_0001.pdf`, etc. — decided
during brainstorming since recovered files have no original name or folder structure to preserve.

## Two new Tauri commands

- `start_recovery_scan(drive: String, destination: String, file_types: Vec<String>) -> Result<String, String>`
  — validates inputs, generates a scan id and result-file path, calls `relaunch_recovery_scan`
  (triggering the UAC prompt), and returns the scan id immediately (does not block on the scan
  itself, which runs in the separate elevated process).
- `get_recovery_progress(scan_id: String) -> Result<RecoveryProgress, String>` — reads and parses
  the scan id's result file; errors if the file doesn't exist yet (a brief window right after
  starting, before the elevated process's first progress write) or fails to parse.

## New plugin permissions

- **`system.drives`** (new) → `api.listDrives(): Promise<{ name: string; path: string; totalBytes: number | null }[]>`,
  reusing the existing `get_drives`/`list_drives` backend (already implemented, just not
  previously plugin-exposed) to populate a real drive dropdown — safer than a free-text drive
  field, and needed for the size-based duration estimate below.
- **`fs.recover`** (new) → `api.startRecoveryScan(drive, destination, fileTypes)` and
  `api.getRecoveryProgress(scanId)`.

## Frontend: `examples/plugins/recover-lost-data/`

A new example plugin (`manifest.json` declaring `ui.sidebar`, `system.drives`, `fs.recover`,
`ui.confirm`, `nav.read`).

Sidebar panel:

- A drive dropdown, populated via `listDrives()` on panel mount.
- Five checkboxes (JPEG, PNG, PDF, ZIP, MP3), all checked by default.
- A destination-folder text field, pre-filled with `getCurrentPath()` if available (same pattern
  `duplicate-finder`/`disk-usage-visualizer` already use for their root-folder inputs) but freely
  editable.
- Once a drive is selected, an estimated-duration readout computed from that drive's
  `totalBytes` against a deliberately conservative assumed read speed (50 MB/s), labeled clearly
  as approximate ("~12 minutes (actual time depends on your drive's speed)") rather than implying
  precision the app can't actually measure without probing the device.
- A **Start Scan** button, gated behind `api.confirm()` summarizing the target drive and estimated
  duration before calling `startRecoveryScan` (kicking off the UAC prompt) — not because the scan
  is destructive, but because it's a consequential, potentially long-running action worth an
  explicit confirmation before triggering an elevation prompt.
- Once started, a progress display (bytes scanned / total as a percentage, files found so far by
  type) that polls `getRecoveryProgress` every second while `status === "running"`, then shows a
  final summary ("Found and recovered 12 files (8 JPEG, 3 PNG, 1 PDF) to `<destination>`") on
  completion, or the error message on failure (e.g. "Elevation was cancelled or could not start").
  No live list of individual recovered files in the UI — browsing the destination folder in the
  core file explorer afterward shows the actual results.

## Testing

- `signatures.rs`: real unit tests — hand-built byte arrays embedding known start/end markers
  (including ones that straddle where a chunk boundary would fall, to prove the overlap logic
  works), asserting correct offset detection and correct capping behavior for ZIP/MP3.
- `progress.rs`: real unit tests — round-trip a `RecoveryProgress` through JSON to/from a real
  temp file (via `tempfile`), covering all three `status` values.
- `scan.rs` and `elevation.rs`: no automated tests, matching the established precedent for code
  that necessarily does real, privileged disk I/O or triggers a real UAC prompt. Verified by hand
  (a later task in the implementation plan) using a spare USB stick with known throwaway files
  deleted onto it beforehand.
- The plugin's own `frontend/index.js`: no automated tests, per this codebase's established
  convention for example plugin entry files.
- `parse_recovery_scan_args` in `main.rs`: real unit tests, mirroring the existing
  `parse_elevated_terminal_args` tests exactly (pure argument-parsing, no I/O).

## Out of scope for this pass

- NTFS Master File Table / USN Journal parsing (a different, filesystem-specific recovery
  strategy — see Scope above for why signature carving was chosen instead for v1).
- Any file type beyond the five listed (more signatures can be added later without changing the
  overall architecture).
- A live, browsable list of recovered files inside the plugin UI.
- Any attempt to recover original filenames, folder structure, or timestamps — none of that
  metadata survives past the point a signature-carving scan can see.
- Cancelling an in-progress scan (once started via the elevated relaunch, it runs to completion
  or failure; there's no cancel button in v1).
