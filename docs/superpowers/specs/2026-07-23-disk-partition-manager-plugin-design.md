# Disk Partition Manager Plugin — Design

## Goal

Let a plugin view and manage disk partitions (create, delete, resize, format, reassign drive
letters) from within Krampus Explorer, with a visual proportional disk map similar to
`diskmgmt.exe`. This is a new, sixth plugin — not part of the original five-plugin roadmap — and
one of the most dangerous built this session: unlike Drive Format and Secure Wipe, which only ever
touch one volume in isolation, partition operations act on a physical disk's partition table, so a
mistake can corrupt or destroy data on **other** partitions on the same disk, not just the target
one. It gets its own dedicated safety-focused brainstorm before any code is written, per the
established pattern this session.

## Why this is riskier than Drive Format or Secure Wipe

Drive Format and Secure Wipe both operate at the volume level (`\\.\D:`), which by construction
can only ever affect the one selected drive letter. Partition operations are different in kind:
deleting, resizing, or creating a partition rewrites the physical disk's partition table, which
every other partition on that disk depends on to be found at all. A bug or a wrong selection here
doesn't just destroy the one partition you meant to touch — it can make sibling partitions
unreadable even though their actual file data was never touched.

## Backend approach: PowerShell Storage cmdlets, not raw APIs

Per explicit direction, all partition operations shell out to Windows' own `Storage` PowerShell
module (`Get-Disk`, `Get-Partition`, `New-Partition`, `Resize-Partition`, `Remove-Partition`,
`Format-Volume`, `Set-Partition`) rather than reimplementing partition-table manipulation via raw
`DeviceIoControl`/`IOCTL_DISK_*` calls. This matches the session's established "delegate the
actually-dangerous action to trusted OS code" pattern (`SHFormatDrive` for Drive Format) — the
partition-table math itself is Microsoft's problem, not this plugin's. `ConvertTo-Json` gives
structured, reliably-parseable output instead of diskpart's human-oriented text.

## System disk: read-only for the entire physical disk

Per explicit direction, this goes further than Drive Format/Secure Wipe's "exclude the one system
drive letter." The plugin resolves which **physical disk number** contains the Windows partition
(via `explorer_filesystem::get_system_drive()` → `Get-Partition -DriveLetter C | Select
DiskNumber`), and then disables every destructive action — delete, resize, format, new partition,
change letter — for **every partition on that disk**, including the EFI System Partition and any
Recovery partition. The whole disk is still shown in the visual map (so the layout makes sense),
just with no clickable destructive actions available anywhere on it. This is enforced in the
backend (each action command re-checks the target disk number, not just trusting the frontend to
have disabled the button) as well as the frontend, matching the two-independent-checks pattern
`is_system_drive` already established for Drive Format/Secure Wipe.

## Operations in scope

Per explicit direction, all five of diskmgmt.exe's common operations:

- **New partition** — create a partition in existing unallocated space, format it (filesystem
  choice: NTFS default, FAT32/exFAT also offered), optionally assign a drive letter.
- **Delete partition** — removes the partition, returning its space to unallocated.
- **Resize** — shrink or extend a partition into adjacent unallocated space (`Resize-Partition`;
  Windows itself enforces what's actually possible — e.g. you can't extend into space that isn't
  immediately adjacent — the plugin surfaces whatever `Get-PartitionSupportedSize` reports as the
  valid range rather than re-deriving those constraints itself).
- **Format** — reformat an existing partition in place (`Format-Volume`), separate from Drive
  Format's whole-drive `SHFormatDrive` dialog — this one targets a single partition and always
  performs a quick format (no full-format option, matching the "these should be fast, no
  long-running-progress machinery" decision below).
- **Change drive letter** — reassign or remove the letter a partition is mounted as
  (`Set-Partition -NewDriveLetter`).

## Confirmation UI: typed confirmation, scaled to severity

Per explicit direction: Delete, Resize, and Format each require typing the partition's drive
letter (or the literal text `DELETE` if the partition has no letter) into a text field before the
action button enables — the same friction level Secure Wipe already established, since (like
Secure Wipe) there's no native OS dialog acting as a second real gate. New Partition uses a normal
`api.confirm()` Confirm/Cancel dialog instead, since creating a partition in unallocated space
can't destroy existing data by construction. Change Drive Letter also uses `api.confirm()` — it
doesn't touch data either, just how a partition is addressed.

## Elevation: per-operation elevated PowerShell process

Per explicit direction — unlike Recovery/Wipe's multi-minute scans, partition operations are
mostly near-instant (delete, new, letter-change) with only Format and large resizes taking real
time, so the multi-minute headless-relaunch-plus-polled-progress-file pattern would be overkill.
Instead, each action:

1. Writes a small PowerShell script to a temp `.ps1` file that runs the specific cmdlet and writes
   its result (success + returned object, or the error message) as JSON to a second temp file.
2. Elevates via `ShellExecuteExW` (not the plain `ShellExecuteW` used elsewhere) with
   `lpVerb = "runas"` and `fMask = SEE_MASK_NOCLOSEPROCESS`, which — unlike plain `ShellExecuteW`
   — returns a process handle in `SHELLEXECUTEINFOW.hProcess`.
3. `WaitForSingleObject(hProcess, INFINITE)`s on that handle from inside a
   `tauri::async_runtime::spawn_blocking` (same pattern `format_drive` already uses to avoid
   blocking the async command thread on a real wait).
4. Reads and parses the JSON result file, deletes both temp files, and returns the result.

This triggers one UAC prompt per action (creating a partition and then formatting it, for
instance, is two separate prompts) — a real usability cost, but it keeps the main app unelevated,
keeps each operation fully isolated with no shared elevated session, and needs no new
progress-polling Tauri command since the wait already blocks until the result is ready.

## New crate: `crates/partitions`

- **`model.rs`** — `DiskInfo` (`number: u32`, `total_bytes: u64`, `is_system: bool`, `model:
  String`, `partitions: Vec<PartitionInfo>`) and `PartitionInfo` (`drive_letter: Option<String>`,
  `size_bytes: u64`, `offset_bytes: u64`, `filesystem: Option<String>`, `partition_type: String`),
  all `Serialize`/`Deserialize`/`camelCase`. Unit-tested for JSON round-tripping only (real values
  always come from parsing PowerShell's output, not constructed by this crate).
- **`list.rs`** — `list_disks() -> Result<Vec<DiskInfo>, String>`, runs `Get-Disk | ConvertTo-Json`
  and `Get-Partition | ConvertTo-Json` via an **unelevated** `std::process::Command` (read-only
  queries don't need Administrator), joins partitions to their disk by `DiskNumber`, and marks
  `is_system` for whichever disk owns the Windows partition. No automated tests for the real
  process-spawning path (matches this session's "no tests for real OS-touching operations"
  precedent); the JSON-parsing logic itself (`parse_disk_json`/`parse_partition_json`, taking a
  `&str` instead of actually running PowerShell) is a pure function and gets real unit tests
  against sample `ConvertTo-Json` output.
- **`system_disk.rs`** — `resolve_system_disk_number() -> Result<Option<u32>, String>`, calls
  `explorer_filesystem::get_system_drive()` then runs a single-purpose `Get-Partition -DriveLetter
  <letter> | Select DiskNumber` query. Returns `None` (rather than erroring) if the system drive
  letter can't be resolved to a disk — callers must then treat *all* disks as non-actionable until
  it resolves, never assume "unknown" means "safe."
- **`actions.rs`** — one function per operation (`new_partition`, `delete_partition`,
  `resize_partition`, `format_partition`, `set_drive_letter`), each building the specific
  PowerShell script text for that cmdlet and calling a shared `run_elevated_action(script: &str) ->
  Result<serde_json::Value, String>` helper. Every function takes the target `disk_number` as a
  required argument and re-validates it against `resolve_system_disk_number()` before doing
  anything — the backend never trusts the frontend alone to have kept a destructive action off the
  system disk. No automated tests for the real elevated-execution path; script-text-building
  functions (given fixed inputs, asserting the exact generated PowerShell string) are pure and
  unit-tested.
- **`elevation.rs`** — `run_elevated_action(script) -> Result<String, String>` (returns the raw
  JSON text from the result file), implementing the `ShellExecuteExW` + `SEE_MASK_NOCLOSEPROCESS`
  + `WaitForSingleObject` sequence described above. No automated tests (real UAC prompt).

`crates/partitions`'s `Cargo.toml` depends on `explorer-filesystem` (for `get_system_drive`) and
`windows-sys` with `Win32_UI_Shell` (`SHELLEXECUTEINFOW`, `ShellExecuteExW`) and
`Win32_System_Threading` (`WaitForSingleObject`) plus `Win32_Foundation`.

## New Tauri commands

- `list_disks() -> Result<Vec<DiskInfo>, String>` — unelevated, populates the visual map.
- `create_partition(diskNumber: u32, offsetBytes: u64, sizeBytes: u64, filesystem: String,
  driveLetter: Option<String>) -> Result<PartitionInfo, String>`
- `delete_partition(diskNumber: u32, driveLetter: String) -> Result<(), String>`
- `resize_partition(diskNumber: u32, driveLetter: String, newSizeBytes: u64) ->
  Result<PartitionInfo, String>`
- `format_partition(diskNumber: u32, driveLetter: String, filesystem: String) ->
  Result<PartitionInfo, String>`
- `set_drive_letter(diskNumber: u32, currentLetter: Option<String>, newLetter: Option<String>) ->
  Result<(), String>`

Each of the five mutating commands wraps its `crates/partitions::actions` call in the same
`spawn_blocking` pattern `format_drive` already uses.

## New plugin permission: `system.partitions`

A new permission, separate from `system.drives` (whole-drive listing) and `fs.format`/`fs.wipe`
(volume-level byte operations) — this permission is specifically about partition-table-level
operations. Grants all six methods above (`listDisks`, `createPartition`, `deletePartition`,
`resizePartition`, `formatPartition`, `setDriveLetter`).

## Frontend: `examples/plugins/disk-partition-manager/`

Sidebar panel, built around the proportional disk map:

- Each physical disk renders as a labeled horizontal bar (`Disk 0 — 512 GB SSD`, with `(System)`
  appended when `is_system`), split into segments sized proportionally to `size_bytes` — including
  a visually distinct "Unallocated" segment for any gap. This is Option A from the visual-companion
  mockup review.
- Clicking a partition segment opens an action panel below the map showing that partition's
  details (letter, size, filesystem) and action buttons (Delete / Resize / Format / Change Letter).
  All four are rendered disabled (with a tooltip: "Not available on the system disk") when the
  parent disk's `is_system` is true.
- Clicking an unallocated segment shows a "New Partition" button instead.
- Delete/Resize/Format open a typed-confirmation panel (type the drive letter or `DELETE`) before
  the real action button enables, matching Secure Wipe's pattern. New Partition/Change Letter use
  `api.confirm()`.
- Since every mutating call blocks on its own UAC prompt + PowerShell round-trip, the UI shows a
  simple "Working…" state (button disabled, spinner) for the duration of that single `await` —
  no polling needed, since the Tauri command itself doesn't resolve until the result file is read.
- After any successful mutating action, the panel re-calls `listDisks()` to refresh the map.

## Testing

- `crates/partitions/src/model.rs`: real unit tests, JSON round-tripping for `DiskInfo`/
  `PartitionInfo`.
- `crates/partitions/src/list.rs`: real unit tests for the pure JSON-parsing functions against
  fixed sample `Get-Disk`/`Get-Partition` JSON output (including the single-object-vs-array
  edge case PowerShell's `ConvertTo-Json` has when there's exactly one result); no tests for the
  real process-spawning path.
- `crates/partitions/src/actions.rs`: real unit tests for the script-text-building functions
  (asserting exact generated PowerShell strings for each operation, including that `disk_number`
  and `drive_letter` values are correctly interpolated); no tests for the real elevated-execution
  path.
- `crates/partitions/src/system_disk.rs` and `elevation.rs`: no automated tests (real OS calls,
  matching this session's established precedent).
- Manual verification must happen against the spare USB stick's partitions or a spare secondary
  physical disk if one is available for testing — **never** against the system disk's partitions.
  Given this plugin's inter-partition blast radius, verifying the system-disk exclusion (no action
  ever becomes clickable on the system disk, backend re-check confirmed by trying to bypass the
  frontend somehow) is the single most important check, ahead of confirming any individual
  operation completes correctly.

## Out of scope for this pass

- MBR/GPT conversion or initializing raw/uninitialized disks — rare operations with their own
  distinct risk profile; disks are assumed already initialized.
- Volume shrink/extend across multiple non-contiguous free regions, or moving a partition to a
  different offset — `Resize-Partition` only supports adjusting a partition's own boundary into
  immediately-adjacent free space, which is what this plugin exposes as-is.
- Dynamic disks / Storage Spaces — this plugin targets basic disks only, matching what
  `Get-Disk`/`Get-Partition` return for a typical single-disk desktop setup.
- Cross-disk operations (e.g. cloning a partition to another disk) — out of scope entirely.
- A cancel button for an in-progress action — each action is a single blocking round-trip, not a
  long-running scan; if it's stuck, the UAC prompt itself is the thing to cancel.
