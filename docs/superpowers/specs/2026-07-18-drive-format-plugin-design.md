# Drive Format Plugin — Design

## Goal

Let a plugin format a drive from within Krampus Explorer. Fourth of five requested plugins, and
the first one that is genuinely, irreversibly destructive by design — unlike every prior plugin
(where deletion goes through the Recycle Bin and is recoverable, or where the operation is
read-only), a successful format permanently destroys everything on the target drive. This design
was deliberately given its own dedicated safety-focused brainstorm, per explicit instruction,
before any code was written.

## Core architectural decision: hand off to Windows' own native Format dialog

Rather than implementing format logic directly (raw disk writes, filesystem structure creation),
this plugin calls `SHFormatDrive` — a documented Win32 Shell API (`shell32.dll`, already exposed
by the `windows-sys` crate this project depends on) that opens **Windows' own built-in Format
dialog**, the exact same UI you get right-clicking a drive in File Explorer and choosing
"Format...".

This is the single most important safety decision in this design:

- **Windows' own dialog already refuses to format the system/boot drive.** That protection lives
  in trusted OS code, not in anything this plugin has to get right itself.
- **The actually-dangerous action — clicking "Start" and confirming Windows' own "WARNING:
  Formatting will erase ALL data on this disk" prompt — happens inside a native OS dialog, not a
  webview button this plugin's JS controls.** There is no code path by which this plugin (or a
  bug in it) could silently trigger a format without a real, separate human click inside Windows'
  own UI.
- **Filesystem choice, allocation unit size, volume label, and quick-vs-full-format** are all
  handled by Windows' own well-tested dialog. This plugin doesn't implement or expose any of
  that — it only gets the user to the point of opening that dialog for the right drive.

`SHFormatDrive`'s signature (confirmed against the vendored `windows-sys` v0.61.2 source):

```rust
pub unsafe extern "system" fn SHFormatDrive(
    hwnd: HWND,
    drive: u32,      // zero-based drive index: A=0, B=1, C=2, D=3, ...
    fmtid: SHFMT_ID,  // SHFMT_ID_DEFAULT (0xFFFF) -- let Windows use its own default
    options: u32,     // SHFMT_OPT_NONE (0) -- no special options
) -> u32;
```

Return value is one of: a normal completion code, or the sentinel constants `SHFMT_CANCEL`
(0xFFFFFFFE, user cancelled the native dialog), `SHFMT_ERROR` (0xFFFFFFFF, the format failed), or
`SHFMT_NOFORMAT` (0xFFFFFFFD, the drive couldn't be formatted at all, e.g. it's the system
drive). `SHFMT_CANCEL` and `SHFMT_NOFORMAT` are normal, expected outcomes to show calmly, not
errors to alarm over — backing out of a format is exactly the safe behavior this design wants to
be easy.

## System-drive exclusion: defense in depth

Even though `SHFormatDrive` itself refuses the system/boot drive, this plugin's own drive picker
filters it out *before* it can even be selected, via `std::env::var("SystemDrive")` (the same
environment variable Windows itself uses to identify the boot volume, e.g. `"C:"`). This is
genuine defense in depth, not cosmetic — two independent checks (this plugin's own filtering, and
Windows' own refusal inside `SHFormatDrive`) both have to fail for the system drive to ever be at
risk, and both would have to fail in the same direction.

## Drive scope

Per explicit direction: **all non-system drives** are selectable (not restricted to removable
media only, unlike some of the other plugins' more conservative scoping) — fixed internal
secondary drives (e.g. a second internal HDD/SSD at `D:` or `E:`) can be selected and formatted
through this plugin, relying on the system-drive exclusion above plus this plugin's own
confirmation gate as the safety boundary, rather than restricting to only removable media.

## New Tauri command

```rust
#[tauri::command]
pub fn format_drive(drive: String) -> Result<FormatOutcome, String>
```

Converts `drive` (e.g. `"D:"`) to its zero-based index, rejects it up front if it matches
`SystemDrive`, calls `SHFormatDrive` with `SHFMT_ID_DEFAULT`/`SHFMT_OPT_NONE`, and maps the
return code to a `FormatOutcome` enum: `Formatted | Cancelled | NoFormat`. A genuine Win32-level
error (`SHFMT_ERROR`) is returned as `Err`, matching this codebase's existing convention that
`Result<T, String>` is for real failures, while `Cancelled`/`NoFormat` are successful returns
representing "nothing bad happened, the user (or Windows) just declined."

## New plugin permission: `fs.format`

Grants `api.formatDrive(drive: string): Promise<"formatted" | "cancelled" | "noFormat">`. Reuses
the already-built `system.drives` permission (`api.listDrives()`) for the drive picker — no new
permission needed there.

## Frontend: `examples/plugins/drive-format/`

A new example plugin (`manifest.json` declaring `ui.sidebar`, `system.drives`, `fs.format`,
`ui.confirm`).

Sidebar panel:

- A drive dropdown populated via `listDrives()`, with the system drive already excluded from the
  list returned to plugins that declare `fs.format` (the exclusion happens on the Rust side of
  `format_drive`'s validation, not just trusted to plugin JS -- but the dropdown itself also
  filters visually so a user never even sees the system drive as an option here).
- A **Format Drive…** button, gated behind `api.confirm()` with explicit, unambiguous wording:
  `"This will PERMANENTLY ERASE ALL DATA on drive D: (500 GB). This cannot be undone. Continue?"`
  — reusing the same `ConfirmDialog` component every other plugin's confirmations use, per
  direction (not a stricter typed-confirmation flow), since the real final safety gate is
  Windows' own native dialog, not this one.
- On confirmation, calls `formatDrive(drive)`, which opens Windows' native Format dialog. The
  plugin's own UI shows a neutral "Waiting for the Format dialog..." status while that call is
  pending (it blocks until the native dialog closes), then reports the outcome plainly:
  "Drive formatted." / "Format cancelled." / "This drive can't be formatted." for the three
  `FormatOutcome` values, or the error message for a real failure.

## Testing

- The drive-letter-to-index conversion and system-drive-exclusion logic are pure functions with
  no I/O -- real unit tests, following this session's established pattern of splitting out
  testable logic from the untestable OS-touching parts.
- `format_drive` itself (the actual `SHFormatDrive` call): **no automated tests.** This is the
  most extreme case yet of this codebase's established precedent for real, destructive,
  human-interactive OS operations having no automated coverage -- there is no way to simulate a
  native modal Windows dialog in `cargo test`, and even if there were, actually exercising a real
  format in CI is obviously unacceptable.
- The plugin's own `frontend/index.js`: no automated tests, per this codebase's established
  convention for example plugin entry files.
- Manual verification must use the spare USB stick discussed earlier in this session, never a
  real data drive. Actually completing a real format during verification (as opposed to just
  confirming the native dialog appears and can be cancelled) is optional and requires explicit
  go-ahead at verification time -- not something to do automatically just because a plan step
  says "verify this."

## Out of scope for this pass

- Any plugin-side UI for filesystem type, allocation unit, volume label, or quick-vs-full-format
  choice -- all of that lives in Windows' own native dialog.
- Removable-only drive restriction (per explicit direction, all non-system drives are in scope).
- A typed-confirmation flow (e.g. "type the drive letter") -- per explicit direction, the existing
  `api.confirm()` Confirm/Cancel pattern is used, consistent with every other plugin.
