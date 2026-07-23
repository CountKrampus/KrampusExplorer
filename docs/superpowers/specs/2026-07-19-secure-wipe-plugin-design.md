# Secure Wipe Plugin — Design

## Goal

Let a plugin securely erase a drive (overwrite its contents so casual/signature-based recovery
can't retrieve them) from within Krampus Explorer. Fifth and last of the five originally
requested plugins, and the most severe one built this session — unlike Drive Format, there's no
Windows-provided native dialog to delegate the actually-dangerous action to. This plugin performs
the destructive write itself, so it was given its own dedicated safety-focused brainstorm before
any code was written, per explicit instruction.

## Why this is riskier than Drive Format

Drive Format handed off to `SHFormatDrive`, Windows' own native dialog — the real "click and
confirm" moment happened inside trusted OS code, not this app's code. Secure Wipe has no
equivalent: it must open the raw volume itself and write to it. A read (like the Recover Lost
Data plugin does) can't destroy data by construction; a write starts destroying data the instant
it begins. This asymmetry is why this design leans on stronger safeguards than Drive Format did.

## Honesty about what this can and can't guarantee

On an HDD, a single overwrite pass genuinely destroys the previous data at the physical level. On
an **SSD**, wear-leveling means the drive's firmware may write "new" data to different physical
cells than the ones holding the "old" data, so an application-level overwrite (which only sees
logical addresses, not physical ones) cannot guarantee the old data is gone — true secure erase
for SSDs needs the drive's own firmware-level ATA Secure Erase command, a different and more
specialized operation this plugin does not implement. Per explicit direction, the plugin **warns
about this but still allows the wipe to proceed** — it's still meaningfully better than a normal
delete or even a format (both leave recoverable data behind on any drive type), just not a
forensic guarantee on flash media.

## Wipe method: single pass, zero-fill

Per explicit direction: one pass writing `0x00` across the entire volume, not a multi-pass
DoD-style pattern. Multiple passes are a legacy/compliance convention with no demonstrated
security benefit over a single pass on modern drives, and every additional pass is proportionally
more time spent with the drive in a partially-wiped state.

## Raw write scope: volume-level, not physical-disk-level

Writes go to `\\.\D:` (the same volume-level raw path the Recover Lost Data plugin already reads
from), **not** `\\.\PhysicalDriveN` (disk-level access, which operates below partition boundaries
and could affect other partitions/drive letters sharing the same physical disk). Volume-level
access confines the blast radius to exactly the one selected drive letter, matching the address
space already proven correct in this session's Recover Lost Data work.

## System-drive exclusion: reusing Drive Format's exact logic

Rather than re-deriving "is this the system drive," this plugin's backend depends on
`crates/filesystem` and calls the exact same `is_system_drive` function Drive Format already has
(and is already tested — 2 of the 8 tests in `crates/filesystem/src/format.rs`). One single
source of truth, not a second copy that could drift. As with Drive Format, this is defense in
depth alongside the frontend's own dropdown filtering: two independent checks both have to fail
in the same direction for the system drive to ever be at risk.

## Drive scope: all non-system drives

Per explicit direction, consistent with Drive Format: any non-system drive is selectable,
including fixed internal secondary drives, not restricted to removable media only. The safety
boundary is the system-drive exclusion plus the confirmation flow below, not a narrower drive
picker.

## Confirmation UI: type the exact drive letter

Per explicit direction — since there's no native OS dialog acting as a second real gate this
time, this plugin's own confirmation *is* the real safety gate, so it gets more friction than the
simple Confirm/Cancel `api.confirm()` pattern every other plugin uses. The plugin's own UI shows
a text field where the user must type the exact selected drive letter (e.g. "I") before the Wipe
button enables — implemented entirely in the plugin's own frontend JS (comparing the typed text
against the selected drive's letter), no new backend primitive needed for this part.

## Elevation and process model

Reuses the exact pattern already proven for the Recover Lost Data plugin: a headless elevated
relaunch (`--secure-wipe --drive=D: --result-file=<path>`), via `ShellExecuteW`/`"runas"`,
running with no window/Tauri/webview, writing progress to a JSON file that the main
(unelevated) app polls via a Tauri command roughly once a second.

## New crate: `crates/wipe`

Mirrors `crates/recovery`'s structure, since it needs the same elevation/headless-process/
progress-file machinery:

- **`progress.rs`** — a `WipeProgress` struct (`status: Running | Completed | Failed`,
  `bytes_written: u64`, `total_bytes: u64`, `error: Option<String>`) serialized to/from a JSON
  file, unit-testable with a real temp file (no admin rights needed, matching
  `crates/recovery/src/progress.rs`'s precedent).
- **`elevation.rs`** — `relaunch_secure_wipe(drive, result_file)`, mirroring
  `crates/recovery/src/elevation.rs`'s `relaunch_recovery_scan` (same `ShellExecuteW`/`"runas"`
  approach, different flag/arguments). No automated tests, matching that file's own precedent.
- **`wipe.rs`** — the real thing: opens the raw volume for **write** access (`GENERIC_WRITE`
  instead of Recover Lost Data's `GENERIC_READ`), refuses up front if the drive is the system
  drive (via `explorer_filesystem::is_system_drive`), then writes a zero-filled buffer
  (16 MiB per write call) in a loop until it has covered the drive's total byte count, updating
  the progress file periodically. No automated tests — this necessarily does real, irreversible,
  privileged disk I/O, the same territory `crates/recovery/src/scan.rs` is already in, just for
  writes instead of reads.

`crates/wipe`'s `Cargo.toml` depends on `explorer-filesystem` (for `is_system_drive` and
`list_drives`, reused for total-byte-count the same way `crates/recovery/src/scan.rs` already
does) and `windows-sys` with `Win32_Storage_FileSystem`/`Win32_Foundation`/`Win32_System_IO`
(for `WriteFile`, confirmed present in the vendored `windows-sys` v0.61.2 source) plus
`Win32_UI_Shell`/`Win32_UI_WindowsAndMessaging` (for `ShellExecuteW`, matching
`crates/recovery`'s existing feature list).

## Two new Tauri commands

- `start_secure_wipe(drive: String) -> Result<String, String>` — validates, generates a result-
  file path (mirroring `start_recovery_scan`'s pattern), calls `relaunch_secure_wipe` (triggering
  the UAC prompt), returns the opaque result-file path as a "wipe id" immediately.
- `get_wipe_progress(wipeId: String) -> Result<WipeProgress, String>` — reads and parses the
  progress file, same polling contract as `get_recovery_progress`.

## New plugin permission: `fs.wipe`

Grants `api.startSecureWipe(drive: string): Promise<string>` and
`api.getWipeProgress(wipeId: string): Promise<WipeProgress>`. Reuses the already-built
`system.drives` (`listDrives`) and `fs.format`'s `getSystemDrive` (for excluding the system drive
from the picker) — no need to duplicate that lookup under a new permission name.

## Frontend: `examples/plugins/secure-wipe/`

A new example plugin (`manifest.json` declaring `ui.sidebar`, `system.drives`, `fs.format`
(for `getSystemDrive` only — this plugin never calls `formatDrive`), `fs.wipe`).

Sidebar panel:

- The SSD warning, shown permanently and prominently (not just in a confirmation dialog) --
  "Secure erase overwrites drive contents but cannot guarantee removal on SSDs due to
  wear-leveling. For guaranteed SSD erasure, use the drive manufacturer's own secure-erase tool."
- A drive dropdown (system drive excluded, same pattern as Drive Format).
- A text field labeled to type the selected drive's letter to confirm; the **Securely Wipe
  Drive** button stays disabled until the typed text exactly matches the selected drive.
- Once enabled and clicked, starts the wipe directly (no separate `api.confirm()` step -- the
  typed-match field already is the confirmation).
- A progress display (bytes written / total as a percentage) polling `getWipeProgress` every
  second while running, then a final summary ("Drive D: was securely wiped.") or the error
  message on failure.

## Testing

- `crates/wipe/src/progress.rs`: real unit tests, identical shape to
  `crates/recovery/src/progress.rs`'s (round-trip through a real temp file, covering all three
  status values).
- `crates/wipe/src/elevation.rs` and `crates/wipe/src/wipe.rs`: no automated tests -- real,
  irreversible, privileged disk I/O and a real UAC prompt, matching the established precedent for
  this class of code throughout this session.
- The plugin's own `frontend/index.js`: no automated tests, per this codebase's established
  convention for example plugin entry files.
- Manual verification must use the spare USB stick, never a real data drive -- and given this is
  the single most destructive plugin built this session, verifying the typed-confirmation gate
  and the system-drive exclusion are the two most important checks, more important than actually
  completing a real wipe (which is optional and requires explicit go-ahead at verification time,
  same as Drive Format's approach).

## Out of scope for this pass

- Multi-pass overwrite patterns (DoD 5220.22-M, Gutmann, etc.) -- single zero-fill pass only, per
  explicit direction.
- ATA Secure Erase (the SSD-firmware-level command) -- a fundamentally different, lower-level
  operation than an application-level overwrite; not implemented here.
- Automatically reformatting the drive after wiping -- the drive is left raw/unformatted, matching
  real wipe tool behavior; use the Drive Format plugin separately if you want to reuse the drive.
- Cancelling an in-progress wipe -- once started via the elevated relaunch, it runs to completion
  or failure, matching Recover Lost Data's same out-of-scope decision for its scan.
- Removable-only drive restriction -- per explicit direction, all non-system drives are in scope,
  consistent with Drive Format.
