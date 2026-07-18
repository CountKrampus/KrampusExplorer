# Drive Format Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Drive Format plugin that hands off to Windows' own native Format dialog
(`SHFormatDrive`) for a user-selected non-system drive, with defense-in-depth system-drive
exclusion and a confirmation gate before the native dialog appears.

**Architecture:** A new `crates/filesystem/src/format.rs` module splits pure, unit-testable logic
(drive-letter-to-index conversion, system-drive detection) from the untestable real thing (the
actual `SHFormatDrive` call, which opens a real modal OS dialog). The Tauri command runs that
blocking call via `spawn_blocking` so it doesn't stall the async runtime while the native dialog
is open. All UI logic lives in the plugin's own JS, as with every prior plugin.

**Tech Stack:** Rust (`windows-sys`'s `SHFormatDrive`), React, TypeScript.

Full design: `docs/superpowers/specs/2026-07-18-drive-format-plugin-design.md`.

---

### Task 1: `crates/filesystem/src/format.rs` — pure logic (tested)

**Files:**
- Create: `crates/filesystem/src/format.rs`
- Modify: `crates/filesystem/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/filesystem/src/format.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FormatOutcome {
    Formatted,
    Cancelled,
    NoFormat,
}

/// Converts a drive letter like "D:" or "d" to the zero-based index `SHFormatDrive` expects
/// (A=0, B=1, C=2, D=3, ...).
pub fn drive_letter_to_index(drive: &str) -> Result<u32, String> {
    let letter = drive.trim_end_matches('\\').trim_end_matches(':').to_uppercase();
    let mut chars = letter.chars();
    let ch = chars.next().ok_or_else(|| format!("Invalid drive '{drive}'"))?;
    if chars.next().is_some() || !ch.is_ascii_alphabetic() {
        return Err(format!("Invalid drive '{drive}'"));
    }
    Ok(ch as u32 - 'A' as u32)
}

/// The system/boot drive, as Windows itself identifies it -- `None` if the `SystemDrive`
/// environment variable isn't set (shouldn't happen on a real Windows install, but handled
/// gracefully rather than assumed).
pub fn get_system_drive() -> Option<String> {
    std::env::var("SystemDrive").ok()
}

fn normalize_drive(drive: &str) -> String {
    drive.trim_end_matches('\\').trim_end_matches(':').to_uppercase()
}

/// True if `drive` is the system/boot drive. This is the authoritative, backend-side check --
/// `format_drive` below refuses to proceed if this is true, independent of whatever the
/// frontend's own dropdown filtering already did.
pub fn is_system_drive(drive: &str) -> bool {
    match get_system_drive() {
        Some(system_drive) => normalize_drive(&system_drive) == normalize_drive(drive),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_letter_to_index_converts_common_letters() {
        assert_eq!(drive_letter_to_index("A:"), Ok(0));
        assert_eq!(drive_letter_to_index("D:"), Ok(3));
        assert_eq!(drive_letter_to_index("Z:"), Ok(25));
    }

    #[test]
    fn drive_letter_to_index_is_case_insensitive() {
        assert_eq!(drive_letter_to_index("d:"), Ok(3));
    }

    #[test]
    fn drive_letter_to_index_handles_a_trailing_backslash() {
        assert_eq!(drive_letter_to_index("D:\\"), Ok(3));
    }

    #[test]
    fn drive_letter_to_index_rejects_multi_character_input() {
        assert!(drive_letter_to_index("DE:").is_err());
    }

    #[test]
    fn drive_letter_to_index_rejects_empty_input() {
        assert!(drive_letter_to_index("").is_err());
    }

    #[test]
    fn drive_letter_to_index_rejects_a_non_letter() {
        assert!(drive_letter_to_index("1:").is_err());
    }

    #[test]
    fn is_system_drive_matches_the_real_system_drive() {
        let system_drive = get_system_drive().expect("SystemDrive should be set on Windows");
        assert!(is_system_drive(&system_drive));
    }

    #[test]
    fn is_system_drive_rejects_a_different_drive() {
        let system_drive = get_system_drive().unwrap_or_default().to_uppercase();
        let other = if system_drive.starts_with('C') { "D:" } else { "C:" };
        assert!(!is_system_drive(other));
    }
}
```

- [ ] **Step 2: Create a minimal module wiring so the tests compile**

In `crates/filesystem/src/lib.rs`, change:

```rust
mod drives;
mod home;
mod known_folders;
mod listing;
mod operations;
mod trash_bin;
```

to:

```rust
mod drives;
mod format;
mod home;
mod known_folders;
mod listing;
mod operations;
mod trash_bin;
```

and add to the `pub use` list (exact placement doesn't matter, alongside the others):

```rust
pub use format::{drive_letter_to_index, get_system_drive, is_system_drive, FormatOutcome};
```

- [ ] **Step 3: Run the tests**

Run: `cargo test -p explorer-filesystem format::`
Expected: PASS, 8 tests. (Written alongside the implementation rather than strictly red-then-
green, since this pure logic is simple enough to get right directly -- but every assertion is a
real, meaningful check against actual behavior, not a placeholder.)

- [ ] **Step 4: Confirm the whole crate still builds and tests pass**

Run: `cargo test -p explorer-filesystem`
Expected: all tests pass (the pre-existing ones plus these 8 new ones).

- [ ] **Step 5: Commit**

```bash
git add crates/filesystem/src/format.rs crates/filesystem/src/lib.rs
git commit -m "Add pure drive-format helper logic (index conversion, system-drive detection)"
```

---

### Task 2: `crates/filesystem/src/format.rs` — the real `format_drive` (untested, real OS dialog)

**Files:**
- Modify: `crates/filesystem/src/format.rs`
- Modify: `crates/filesystem/src/lib.rs`
- Modify: `crates/filesystem/Cargo.toml`

This task has **no automated tests** -- `SHFormatDrive` opens a real, modal native Windows
dialog and blocks until a human dismisses it. This is the most extreme case yet of this
codebase's established precedent for real, human-interactive, destructive OS operations having
no automated coverage (see `delete_entry`, the Recycling Bin plugin's trash functions, and the
Recover Lost Data plugin's `scan.rs`/`elevation.rs`). Verified by hand in Task 8.

- [ ] **Step 1: Add the `Win32_UI_Shell` feature**

In `crates/filesystem/Cargo.toml`, change:

```toml
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.61", features = ["Win32_Storage_FileSystem", "Win32_Foundation"] }
```

to:

```toml
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.61", features = [
    "Win32_Storage_FileSystem",
    "Win32_Foundation",
    "Win32_UI_Shell",
] }
```

- [ ] **Step 2: Add `format_drive` to `format.rs`**

In `crates/filesystem/src/format.rs`, add after `is_system_drive`:

```rust
/// Opens Windows' own native Format dialog for `drive`, parented to the window whose raw handle
/// is `hwnd` (an `isize` -- see the Tauri command in `commands.rs` for why it crosses the
/// `spawn_blocking` boundary as an isize rather than a raw pointer, which isn't `Send`).
///
/// Refuses up front if `drive` is the system drive -- defense in depth alongside the frontend's
/// own dropdown filtering (see the plugin's `getSystemDrive`/`listDrives` usage) and Windows'
/// own refusal inside `SHFormatDrive` itself. Two independent checks both have to fail in the
/// same direction for the system drive to ever be at risk.
///
/// `SHFMT_CANCEL` (the user backed out of the native dialog) and `SHFMT_NOFORMAT` (Windows
/// itself declined, e.g. because the drive turned out to be unformattable for some reason) are
/// normal, successful outcomes -- only a genuine `SHFMT_ERROR` is treated as a real failure.
#[cfg(windows)]
pub fn format_drive(drive: &str, hwnd: isize) -> Result<FormatOutcome, String> {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Shell::{
        SHFormatDrive, SHFMT_CANCEL, SHFMT_ERROR, SHFMT_ID_DEFAULT, SHFMT_NOFORMAT, SHFMT_OPT_NONE,
    };

    if is_system_drive(drive) {
        return Err(format!("Refusing to format the system drive '{drive}'"));
    }
    let index = drive_letter_to_index(drive)?;

    // SAFETY: `hwnd` is either a valid window handle obtained from the calling Tauri window, or
    // 0 (no parent) -- both are valid inputs to SHFormatDrive, which is a standard Win32 Shell
    // API. It shows a modal dialog and blocks the calling thread until the user dismisses it.
    let result = unsafe {
        SHFormatDrive(hwnd as HWND, index, SHFMT_ID_DEFAULT, SHFMT_OPT_NONE as u32)
    };

    match result {
        SHFMT_ERROR => Err("The format operation failed".to_string()),
        SHFMT_CANCEL => Ok(FormatOutcome::Cancelled),
        SHFMT_NOFORMAT => Ok(FormatOutcome::NoFormat),
        _ => Ok(FormatOutcome::Formatted),
    }
}

#[cfg(not(windows))]
pub fn format_drive(_drive: &str, _hwnd: isize) -> Result<FormatOutcome, String> {
    Err("Drive formatting is only supported on Windows".to_string())
}
```

- [ ] **Step 3: Confirm the crate builds**

Run: `cargo build -p explorer-filesystem`
Expected: builds successfully.

- [ ] **Step 4: Run the existing tests to confirm nothing broke**

Run: `cargo test -p explorer-filesystem`
Expected: all tests still pass (this step adds no new tests, per this task's intro).

- [ ] **Step 5: Commit**

```bash
git add crates/filesystem/Cargo.toml crates/filesystem/src/format.rs
git commit -m "Add the real format_drive, backed by Windows' native Format dialog"
```

---

### Task 3: Tauri commands `format_drive` and `get_system_drive`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the commands**

In `apps/desktop/src-tauri/src/commands.rs`, change the top `use explorer_filesystem::{...}` line
from:

```rust
use explorer_filesystem::{
    list_directory, list_drives, DirectoryListing, DriveInfo, KnownFolder, TrashedItem,
};
```

to:

```rust
use explorer_filesystem::{
    list_directory, list_drives, DirectoryListing, DriveInfo, FormatOutcome, KnownFolder,
    TrashedItem,
};
```

Then add, after the existing `get_recovery_progress` command:

```rust
#[tauri::command]
pub fn get_system_drive() -> Option<String> {
    explorer_filesystem::get_system_drive()
}

/// `async` (unlike most commands in this file) so the blocking `SHFormatDrive` call -- which
/// opens a real modal Windows dialog and blocks until the user dismisses it, potentially for
/// minutes -- runs via `spawn_blocking` rather than stalling a synchronous command handler.
/// `window.hwnd()` returns a `windows::Win32::Foundation::HWND` (a tuple struct wrapping a raw
/// pointer); `.0 as isize` converts it to a `Send`-able integer that can cross into the
/// `spawn_blocking` closure, then back to a pointer-typed HWND inside `format_drive` itself.
#[tauri::command]
pub async fn format_drive(window: tauri::WebviewWindow, drive: String) -> Result<FormatOutcome, String> {
    let hwnd = window
        .hwnd()
        .map_err(|e| format!("Could not get the window handle: {e}"))?
        .0 as isize;

    tauri::async_runtime::spawn_blocking(move || explorer_filesystem::format_drive(&drive, hwnd))
        .await
        .map_err(|e| format!("Format task panicked: {e}"))?
}
```

- [ ] **Step 2: Register the commands**

In `apps/desktop/src-tauri/src/lib.rs`, find the `commands::get_recovery_progress,` line and add
right after it:

```rust
            commands::get_recovery_progress,
            commands::get_system_drive,
            commands::format_drive,
```

- [ ] **Step 3: Confirm the whole workspace builds**

Run: `cargo build --workspace`
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "Add Tauri commands for drive formatting and system-drive lookup"
```

---

### Task 4: Plugin API — `fs.format`

**Files:**
- Modify: `apps/desktop/src/types/plugin.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.test.ts`

- [ ] **Step 1: Add the new `PluginApi` methods to `types/plugin.ts`**

In `apps/desktop/src/types/plugin.ts`, add to `PluginApi`, right after `getRecoveryProgress`:

```ts
  /** Present only if the plugin's manifest declares the "fs.format" permission. The system/boot
   * drive (e.g. "C:"), or `null` if it couldn't be determined. Use this to exclude it from any
   * drive picker -- the backend's own `formatDrive` independently refuses it too, but a plugin
   * should never even offer it as a selectable option. */
  getSystemDrive?: () => Promise<string | null>;
  /** Present only if the plugin's manifest declares the "fs.format" permission. Opens Windows'
   * own native Format dialog for `drive` (e.g. "D:") and resolves once it closes. Refuses (with
   * a rejected promise) if `drive` is the system drive. `"cancelled"` and `"noFormat"` are
   * normal outcomes -- the user backed out of the native dialog, or Windows itself declined --
   * not errors. */
  formatDrive?: (drive: string) => Promise<"formatted" | "cancelled" | "noFormat">;
```

- [ ] **Step 2: Write the failing tests**

In `apps/desktop/src/plugins/pluginApi.test.ts`:

1. Add to the `handlers()` mock, right after `getRecoveryProgress`:

```ts
    getSystemDrive: vi.fn().mockResolvedValue("C:"),
    formatDrive: vi.fn().mockResolvedValue("formatted"),
```

2. Add `"fs.format"` to `ALL_PERMISSIONS`.
3. Add to `ALL_METHODS`, right after `"getRecoveryProgress"`:

```ts
    "getSystemDrive",
    "formatDrive",
```

4. Add a new row to the `it.each` table, right after the `fs.recover` row:

```ts
    ["fs.format", ["getSystemDrive", "formatDrive"]],
```

5. Add two dedicated forwarding tests, after the existing `getRecoveryProgress calls the handler
   with the scan id` test:

```ts
  it("getSystemDrive calls the handler with no arguments", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["fs.format"]), h);

    await api.getSystemDrive?.();

    expect(h.getSystemDrive).toHaveBeenCalledWith();
  });

  it("formatDrive calls the handler with the drive", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["fs.format"]), h);

    await api.formatDrive?.("D:");

    expect(h.formatDrive).toHaveBeenCalledWith("D:");
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npm test -- --run pluginApi`
Expected: FAIL -- `getSystemDrive`/`formatDrive` don't exist on `PluginApiHandlers` yet.

- [ ] **Step 4: Wire `pluginApi.ts`**

In `apps/desktop/src/plugins/pluginApi.ts`, add to `PluginApiHandlers`, right after
`getRecoveryProgress`:

```ts
  getSystemDrive: () => Promise<string | null>;
  formatDrive: (drive: string) => Promise<"formatted" | "cancelled" | "noFormat">;
```

Then add to `createPluginApi`, right after the `fs.recover` block:

```ts
  if (has("fs.format")) {
    api.getSystemDrive = () => handlers.getSystemDrive();
    api.formatDrive = (drive) => handlers.formatDrive(drive);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/desktop && npm test -- --run pluginApi`
Expected: PASS.

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/types/plugin.ts apps/desktop/src/plugins/pluginApi.ts apps/desktop/src/plugins/pluginApi.test.ts
git commit -m "Add fs.format to the plugin permission system"
```

---

### Task 5: Real handler wiring in `usePluginStore.ts`

**Files:**
- Modify: `apps/desktop/src/stores/usePluginStore.ts`

- [ ] **Step 1: Add the real handlers**

In `apps/desktop/src/stores/usePluginStore.ts`, find the line `getRecoveryProgress: (scanId) =>
invoke<RecoveryProgress>("get_recovery_progress", { scanId }),` and add right after it:

```ts
          getSystemDrive: () => invoke<string | null>("get_system_drive"),
          formatDrive: (drive) =>
            invoke<"formatted" | "cancelled" | "noFormat">("format_drive", { drive }),
```

- [ ] **Step 2: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/stores/usePluginStore.ts
git commit -m "Wire real getSystemDrive and formatDrive handlers into usePluginStore"
```

---

### Task 6: The `examples/plugins/drive-format/` plugin

**Files:**
- Create: `examples/plugins/drive-format/manifest.json`
- Create: `examples/plugins/drive-format/frontend/index.js`
- Create: `examples/plugins/drive-format/README.md`

- [ ] **Step 1: Create the manifest**

Create `examples/plugins/drive-format/manifest.json`:

```json
{
  "id": "drive-format",
  "name": "Drive Format",
  "version": "1.0.0",
  "author": "Krampus Explorer",
  "permissions": ["ui.sidebar", "system.drives", "fs.format", "ui.confirm"],
  "entry": "frontend/index.js"
}
```

- [ ] **Step 2: Create the entry file**

Create `examples/plugins/drive-format/frontend/index.js`:

```js
// Entry point for the "Drive Format" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", listDrives: "system.drives", getSystemDrive/
// formatDrive: "fs.format", confirm: "ui.confirm").
//
// This plugin does NOT implement formatting itself -- formatDrive() opens Windows' own native
// Format dialog. Everything here is about safely getting to that point: excluding the system
// drive from the picker, and one explicit confirmation before the native dialog appears.

function formatSize(bytes) {
  if (bytes === null) return "unknown size";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

api.registerSidebarPanel({
  id: "drive-format",
  title: "Drive Format",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const warning = document.createElement("p");
    warning.style.margin = "0";
    warning.style.color = "var(--danger, #d33)";
    warning.style.fontWeight = "600";
    warning.textContent = "Formatting permanently erases everything on a drive. This cannot be undone.";

    const driveSelect = document.createElement("select");
    driveSelect.style.padding = "4px 6px";
    driveSelect.style.fontSize = "12px";

    const formatBtn = document.createElement("button");
    formatBtn.textContent = "Format Drive…";
    formatBtn.style.padding = "5px 10px";
    formatBtn.style.fontSize = "12px";
    formatBtn.style.cursor = "pointer";
    formatBtn.disabled = true;

    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    let drives = [];

    function selectedDrive() {
      return drives.find((d) => d.name === driveSelect.value) ?? null;
    }

    async function loadDrives() {
      try {
        const [allDrives, systemDrive] = await Promise.all([api.listDrives(), api.getSystemDrive()]);
        const normalizedSystemDrive = systemDrive?.replace(/\\$/, "").toUpperCase() ?? null;
        drives = allDrives.filter((d) => d.name.toUpperCase() !== normalizedSystemDrive);

        driveSelect.innerHTML = "";
        if (drives.length === 0) {
          setStatus("No non-system drives found.", false);
          formatBtn.disabled = true;
          return;
        }
        for (const drive of drives) {
          const option = document.createElement("option");
          option.value = drive.name;
          option.textContent = `${drive.name} (${formatSize(drive.totalBytes)})`;
          driveSelect.appendChild(option);
        }
        formatBtn.disabled = false;
        setStatus("", false);
      } catch (error) {
        setStatus(String(error), true);
      }
    }

    formatBtn.addEventListener("click", async () => {
      const drive = selectedDrive();
      if (!drive) {
        setStatus("Select a drive to format.", true);
        return;
      }

      const ok = await api.confirm(
        `This will PERMANENTLY ERASE ALL DATA on drive ${drive.name} (${formatSize(drive.totalBytes)}). ` +
          `This cannot be undone. Continue?`,
      );
      if (!ok) return;

      formatBtn.disabled = true;
      setStatus("Waiting for the Format dialog…", false);
      try {
        const outcome = await api.formatDrive(drive.name);
        if (outcome === "formatted") {
          setStatus(`Drive ${drive.name} was formatted.`, false);
        } else if (outcome === "cancelled") {
          setStatus("Format cancelled.", false);
        } else {
          setStatus(`Drive ${drive.name} can't be formatted.`, true);
        }
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        formatBtn.disabled = false;
      }
    });

    container.appendChild(warning);
    container.appendChild(driveSelect);
    container.appendChild(formatBtn);
    container.appendChild(status);

    void loadDrives();
  },
});
```

- [ ] **Step 3: Create the README**

Create `examples/plugins/drive-format/README.md`:

```md
# Drive Format

Sidebar panel for formatting a drive. This plugin does not implement formatting itself -- it
hands off to Windows' own native Format dialog (`SHFormatDrive`), the same one you get
right-clicking a drive in File Explorer and choosing "Format...". Filesystem type, allocation
unit, volume label, and quick-vs-full-format are all chosen in that native dialog, not here.

**This is permanently destructive.** The drive picker excludes the system/boot drive, and
Windows itself independently refuses to format it too, but any other selected drive really will
have all of its data erased once you confirm both this plugin's warning and Windows' own dialog.

## Permissions

- `ui.sidebar` — registers the panel.
- `system.drives` — lists available drives for the drive picker.
- `fs.format` — looks up the system drive (to exclude it) and opens the native Format dialog.
- `ui.confirm` — one explicit confirmation before the native dialog appears.
```

- [ ] **Step 4: Typecheck and run the full frontend test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass. (The new plugin's `frontend/index.js` isn't covered by
this -- it's runtime-loaded example plugin code, no build step, matching every other example
plugin's lack of automated coverage.)

- [ ] **Step 5: Commit**

```bash
git add examples/plugins/drive-format/
git commit -m "Add the Drive Format example plugin"
```

---

### Task 7: Docs and marketplace listing

**Files:**
- Modify: `docs/plugins.md`
- Modify: `marketplace.json`

- [ ] **Step 1: Document the new permission in `docs/plugins.md`**

Add a new row to the permissions table, right after the `fs.recover` row:

```md
| `fs.format` | `api.getSystemDrive()`, `api.formatDrive(drive)` |
```

Then add a new section after `### \`fs.recover\` methods`' closing paragraph:

```md
### `fs.format` methods

- `getSystemDrive(): Promise<string | null>` — the system/boot drive (e.g. `"C:"`), or `null` if
  it couldn't be determined. Use this to exclude it from any drive picker -- `formatDrive`
  independently refuses it too, but a plugin should never even offer it as a selectable option.
- `formatDrive(drive: string): Promise<"formatted" | "cancelled" | "noFormat">` — opens Windows'
  own native Format dialog for `drive` and resolves once it closes. **Permanently destroys all
  data on the drive if the user completes the dialog.** `"cancelled"` (the user backed out of the
  native dialog) and `"noFormat"` (Windows itself declined) are normal outcomes, not errors --
  only a rejected promise represents a genuine failure. Refuses up front (rejected promise) if
  `drive` is the system drive.

This plugin does not implement formatting itself; it hands off entirely to Windows' own native
Format dialog, which handles filesystem type, allocation unit, volume label, and
quick-vs-full-format choice. See `examples/plugins/drive-format/` for the reference
implementation, including the confirmation flow expected before calling `formatDrive`.
```

- [ ] **Step 2: Add the new example plugin to the intro list**

In `docs/plugins.md`, find the `recover-lost-data` bullet and add right after it:

```md
- `examples/plugins/drive-format/` — hands off to Windows' native Format dialog via `fs.format`
```

- [ ] **Step 3: Add to `marketplace.json`**

In `marketplace.json` (repo root), add an entry after the `recover-lost-data` entry:

```json
  {
    "id": "drive-format",
    "name": "Drive Format",
    "description": "Format a drive via Windows' own native Format dialog. Permanently erases data."
  }
```

- [ ] **Step 4: Validate the JSON and typecheck**

Run: `node -e "JSON.parse(require('fs').readFileSync('marketplace.json'))" && node -e "JSON.parse(require('fs').readFileSync('examples/plugins/drive-format/manifest.json'))"`
Expected: no output (both parse successfully).

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add docs/plugins.md marketplace.json
git commit -m "Document fs.format and list the new plugin in the marketplace"
```

---

### Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full Rust workspace verification**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: fmt makes no unexpected changes (or auto-fixes formatting -- if it changes anything,
commit that separately as `git commit -m "Run cargo fmt"`), clippy is clean, all tests pass
(including the 8 new `format::` tests).

- [ ] **Step 2: Full frontend verification**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: all green.

- [ ] **Step 3: Manual verification (cannot be automated) -- use the spare USB stick, never a real data drive**

`format_drive` has no automated coverage (per Task 2's intro), and this feature is the most
severe destructive action built so far, so verify by hand and carefully:

1. Install/sync the Drive Format plugin (via the marketplace, or copy
   `examples/plugins/drive-format/` into your local plugins directory and use the "Local Plugins
   (dev)" sync tool in Settings if iterating locally).
2. Open the plugin panel. Confirm the drive dropdown lists your other drives but **does NOT
   include `C:` (or whatever your actual system drive is)** -- this is the most important single
   check in this whole plan. If the system drive appears in the dropdown, stop and treat that as
   a critical bug, not a minor issue.
3. Select the spare USB stick, click **Format Drive…**, and confirm the warning dialog states
   the correct drive letter and size.
4. Confirm it. Confirm Windows' own native Format dialog appears (a real OS window, not part of
   the app), showing the correct drive.
5. Click **Cancel** in Windows' own dialog (do not actually format anything yet). Confirm the
   plugin's status shows "Format cancelled." and the Format Drive… button becomes usable again --
   proves the cancelled path is handled correctly without needing to destroy any data to verify
   it.
6. **Actually completing a real format is optional and your call** -- only do it if you're
   deliberately testing against the spare stick and are fine losing its current contents. If you
   do: confirm Windows' dialog completes normally and the plugin's status shows "Drive \<letter\>
   was formatted."

- [ ] **Step 4: Report any failures as real bugs to fix**, not to note-and-move-past. Step 3.2
  (system drive must never appear in the dropdown) is a correctness-critical check, not a nice-
  to-have -- if it fails, stop and fix it before considering this plugin done.
