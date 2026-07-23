# Secure Wipe Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Secure Wipe plugin that securely erases a drive with a single zero-fill pass over
its raw volume bytes, requiring Administrator elevation, with a typed-drive-letter confirmation
as the plugin's own safety gate (there's no native OS dialog to delegate to, unlike Drive
Format).

**Architecture:** A new `crates/wipe` crate mirrors `crates/recovery`'s structure exactly (a
headless elevated relaunch writing progress to a polled JSON file), but performs raw volume
**writes** instead of reads. It depends on `crates/filesystem` to reuse the already-tested
`is_system_drive` check from the Drive Format plugin rather than duplicating that logic.

**Tech Stack:** Rust (`windows-sys`'s `WriteFile`/`ShellExecuteW`), React, TypeScript.

Full design: `docs/superpowers/specs/2026-07-19-secure-wipe-plugin-design.md`.

---

### Task 1: `crates/wipe` — progress file (pure I/O, tested)

**Files:**
- Create: `crates/wipe/Cargo.toml`
- Create: `crates/wipe/src/progress.rs`
- Create: `crates/wipe/src/lib.rs`
- Modify: `Cargo.toml` (workspace root)

- [ ] **Step 1: Register the new crate in the workspace**

In `Cargo.toml` (repo root), change:

```toml
members = [
    "crates/core",
    "crates/filesystem",
    "crates/search",
    "crates/preview",
    "crates/plugins",
    "crates/settings",
    "crates/terminal",
    "crates/recovery",
    "apps/desktop/src-tauri",
]
```

to:

```toml
members = [
    "crates/core",
    "crates/filesystem",
    "crates/search",
    "crates/preview",
    "crates/plugins",
    "crates/settings",
    "crates/terminal",
    "crates/recovery",
    "crates/wipe",
    "apps/desktop/src-tauri",
]
```

- [ ] **Step 2: Create the crate manifest**

Create `crates/wipe/Cargo.toml`:

```toml
[package]
name = "explorer-wipe"
version.workspace = true
edition.workspace = true
license.workspace = true

[lib]
name = "explorer_wipe"
path = "src/lib.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
explorer-filesystem = { path = "../filesystem" }

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.61", features = [
    "Win32_Storage_FileSystem",
    "Win32_Foundation",
    "Win32_Security",
    "Win32_System_IO",
    "Win32_UI_Shell",
    "Win32_UI_WindowsAndMessaging",
] }

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Write the failing tests**

Create `crates/wipe/src/progress.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WipeStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WipeProgress {
    pub status: WipeStatus,
    pub bytes_written: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
}

pub(crate) fn write_progress(path: &Path, progress: &WipeProgress) -> Result<(), String> {
    let json =
        serde_json::to_string(progress).map_err(|e| format!("Could not serialize progress: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("Could not write progress file: {e}"))
}

pub fn read_progress(path: &Path) -> Result<WipeProgress, String> {
    let json = std::fs::read_to_string(path)
        .map_err(|e| format!("Could not read progress file: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("Could not parse progress file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_running_progress_through_a_real_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let original = WipeProgress {
            status: WipeStatus::Running,
            bytes_written: 1024,
            total_bytes: 2048,
            error: None,
        };

        write_progress(&path, &original).unwrap();
        assert_eq!(read_progress(&path).unwrap(), original);
    }

    #[test]
    fn round_trips_a_completed_progress() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let original = WipeProgress {
            status: WipeStatus::Completed,
            bytes_written: 2048,
            total_bytes: 2048,
            error: None,
        };

        write_progress(&path, &original).unwrap();
        assert_eq!(read_progress(&path).unwrap(), original);
    }

    #[test]
    fn round_trips_a_failed_progress_with_an_error_message() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let original = WipeProgress {
            status: WipeStatus::Failed,
            bytes_written: 512,
            total_bytes: 2048,
            error: Some("Could not open drive".to_string()),
        };

        write_progress(&path, &original).unwrap();
        assert_eq!(read_progress(&path).unwrap(), original);
    }

    #[test]
    fn reading_a_missing_file_fails_with_a_clear_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("does-not-exist.json");
        let err = read_progress(&path).unwrap_err();
        assert!(err.contains("Could not read progress file"));
    }
}
```

- [ ] **Step 4: Create a minimal `lib.rs` so the tests compile**

Create `crates/wipe/src/lib.rs`:

```rust
mod progress;

pub use progress::{read_progress, WipeProgress, WipeStatus};
```

- [ ] **Step 5: Run the tests**

Run: `cargo test -p explorer-wipe`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml crates/wipe/Cargo.toml crates/wipe/src/progress.rs crates/wipe/src/lib.rs
git commit -m "Add explorer-wipe crate with progress-file read/write"
```

---

### Task 2: `crates/wipe` — the real wipe (untested, real disk write)

**Files:**
- Create: `crates/wipe/src/wipe.rs`
- Modify: `crates/wipe/src/lib.rs`
- Modify: `crates/wipe/src/progress.rs`

This task has **no automated tests** -- it opens a real raw volume for writing and requires real
Administrator elevation to succeed. This is the single most severe case of this codebase's
established precedent for real, privileged, irreversible OS operations having no automated
coverage: unlike `crates/recovery/src/scan.rs` (which only reads), this necessarily destroys real
data the moment it runs. Verified by hand in Task 8, using the spare USB stick only.

- [ ] **Step 1: Confirm `write_progress` is already crate-visible**

`crates/wipe/src/progress.rs`'s `write_progress` was already written as `pub(crate)` in Task 1
(not `pub`), since it's only ever called from within this crate -- no change needed here, just
confirming before Step 2 uses it.

- [ ] **Step 2: Write `wipe.rs`**

Create `crates/wipe/src/wipe.rs`:

```rust
use crate::progress::{write_progress, WipeProgress, WipeStatus};
use std::path::Path;

/// Runs a full secure wipe: resolves `drive`'s total size, refuses if it's the system drive,
/// then overwrites the entire volume with zeros, writing progress to `result_file_path`
/// throughout (see `progress.rs`). This is the entry point called from the headless elevated
/// process (see `apps/desktop/src-tauri/src/main.rs`'s `--secure-wipe` dispatch) -- there is no
/// window, no Tauri, and no other way for the caller to observe what's happening except by
/// polling that file.
pub fn run_wipe(drive: &str, result_file_path: &str) -> Result<(), String> {
    let result_path = Path::new(result_file_path);

    if explorer_filesystem::is_system_drive(drive) {
        let err = format!("Refusing to wipe the system drive '{drive}'");
        write_progress(
            result_path,
            &WipeProgress {
                status: WipeStatus::Failed,
                bytes_written: 0,
                total_bytes: 0,
                error: Some(err.clone()),
            },
        )?;
        return Err(err);
    }

    let total_bytes = total_bytes_for_drive(drive)?;

    let mut progress = WipeProgress {
        status: WipeStatus::Running,
        bytes_written: 0,
        total_bytes,
        error: None,
    };
    write_progress(result_path, &progress)?;

    match wipe_volume(drive, total_bytes, result_path, &mut progress) {
        Ok(()) => {
            progress.status = WipeStatus::Completed;
            write_progress(result_path, &progress)?;
            Ok(())
        }
        Err(e) => {
            progress.status = WipeStatus::Failed;
            progress.error = Some(e.clone());
            write_progress(result_path, &progress)?;
            Err(e)
        }
    }
}

fn total_bytes_for_drive(drive: &str) -> Result<u64, String> {
    let normalized = drive.trim_end_matches('\\').trim_end_matches(':').to_uppercase();
    explorer_filesystem::list_drives()
        .into_iter()
        .find(|d| d.name.trim_end_matches(':').to_uppercase() == normalized)
        .and_then(|d| d.total_bytes)
        .ok_or_else(|| format!("Could not determine the size of drive '{drive}'"))
}

#[cfg(windows)]
fn wipe_volume(
    drive: &str,
    total_bytes: u64,
    result_path: &Path,
    progress: &mut WipeProgress,
) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, WriteFile, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    };

    let letter = drive.trim_end_matches('\\').trim_end_matches(':').to_uppercase();
    let raw_path = format!(r"\\.\{letter}:");
    let wide: Vec<u16> = raw_path.encode_utf16().chain(std::iter::once(0)).collect();

    // SAFETY: `wide` is a valid null-terminated UTF-16 string for the duration of this call; the
    // security-attributes and template-file arguments are null, which Win32 documents as valid
    // ("no security attributes" / "no template").
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(format!(
            "Could not open '{raw_path}' for raw write -- this must run elevated (Administrator)"
        ));
    }

    // 16 MiB per write call -- large enough for efficient sequential writes, small enough that
    // one allocation is trivial and progress updates stay frequent.
    const CHUNK_SIZE: usize = 16 * 1024 * 1024;
    let zeros = vec![0u8; CHUNK_SIZE];
    let mut bytes_written: u64 = 0;

    let result = (|| -> Result<(), String> {
        while bytes_written < total_bytes {
            let remaining = total_bytes - bytes_written;
            let this_write = remaining.min(CHUNK_SIZE as u64) as usize;

            let mut written: u32 = 0;
            // SAFETY: `handle` is a valid open handle from the successful CreateFileW call
            // above; `zeros` is valid and at least `this_write` bytes long for the duration of
            // this call; `written` is a valid `u32` local Win32 writes the actual count into.
            let ok = unsafe {
                WriteFile(
                    handle,
                    zeros.as_ptr(),
                    this_write as u32,
                    &mut written,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 || written == 0 {
                return Err("Write to the drive failed partway through".to_string());
            }

            bytes_written += written as u64;
            progress.bytes_written = bytes_written;
            write_progress(result_path, progress)?;
        }
        Ok(())
    })();

    // SAFETY: `handle` was returned by the successful CreateFileW call above and hasn't been
    // closed yet on any path reaching here.
    unsafe {
        CloseHandle(handle);
    }

    result
}

#[cfg(not(windows))]
fn wipe_volume(
    _drive: &str,
    _total_bytes: u64,
    _result_path: &Path,
    _progress: &mut WipeProgress,
) -> Result<(), String> {
    Err("Secure wipe is only supported on Windows".to_string())
}
```

- [ ] **Step 3: Wire it into `lib.rs`**

In `crates/wipe/src/lib.rs`, change:

```rust
mod progress;

pub use progress::{read_progress, WipeProgress, WipeStatus};
```

to:

```rust
mod progress;
mod wipe;

pub use progress::{read_progress, WipeProgress, WipeStatus};
pub use wipe::run_wipe;
```

- [ ] **Step 4: Confirm the crate builds**

Run: `cargo build -p explorer-wipe`
Expected: builds successfully.

- [ ] **Step 5: Run the existing tests to confirm nothing broke**

Run: `cargo test -p explorer-wipe`
Expected: PASS, 4 tests (unchanged from Task 1 -- this task adds no tests, per this task's
intro).

- [ ] **Step 6: Commit**

```bash
git add crates/wipe/src/wipe.rs crates/wipe/src/lib.rs
git commit -m "Add the real secure-wipe volume overwrite"
```

---

### Task 3: `crates/wipe` — elevation relaunch (untested, real UAC)

**Files:**
- Create: `crates/wipe/src/elevation.rs`
- Modify: `crates/wipe/src/lib.rs`

No automated tests -- triggering a real UAC prompt can't be exercised in `cargo test`, matching
`crates/recovery/src/elevation.rs`'s own precedent.

- [ ] **Step 1: Write `elevation.rs`**

Create `crates/wipe/src/elevation.rs`:

```rust
//! Relaunches the app elevated (triggering the Windows UAC consent prompt) to run a headless
//! secure wipe as a separate process -- mirrors `crates/recovery/src/elevation.rs`'s
//! `relaunch_recovery_scan` (itself mirroring `crates/terminal/src/elevation.rs`'s original
//! `relaunch_elevated_terminal`). See `apps/desktop/src-tauri/src/main.rs`'s `--secure-wipe`
//! dispatch for what the relaunched process actually does.

#[cfg(windows)]
mod windows_impl {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;

    pub fn relaunch_secure_wipe(drive: &str, result_file: &str) -> Result<(), String> {
        let exe = std::env::current_exe()
            .map_err(|e| format!("Could not find own executable: {e}"))?;
        let exe_str = exe.to_string_lossy().to_string();

        let params = format!(
            "--secure-wipe --drive={} --result-file={}",
            quote_arg(drive),
            quote_arg(result_file),
        );

        let exe_wide = to_wide(&exe_str);
        let params_wide = to_wide(&params);
        let verb_wide = to_wide("runas");

        // SW_SHOWNORMAL = 1. HWND null = no owner window.
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb_wide.as_ptr(),
                exe_wide.as_ptr(),
                params_wide.as_ptr(),
                std::ptr::null(),
                1,
            )
        };

        // Per the Win32 ShellExecute docs, a return value greater than 32 indicates success;
        // values 0-32 are error codes (including what's returned if the UAC prompt is declined).
        if (result as isize) <= 32 {
            return Err("Elevation was cancelled or could not start".to_string());
        }

        Ok(())
    }

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Quotes `value` for use as a single Windows command-line argument -- see
    /// `crates/terminal/src/elevation.rs`'s identical `quote_arg` for the full reasoning about
    /// trailing backslashes; duplicated here rather than shared, matching
    /// `crates/recovery/src/elevation.rs`'s same duplication (no shared string-utilities crate
    /// exists in this workspace, and it's a small, self-contained function).
    fn quote_arg(value: &str) -> String {
        let trailing_backslashes = value.chars().rev().take_while(|&c| c == '\\').count();
        let mut quoted = String::with_capacity(value.len() + trailing_backslashes + 2);
        quoted.push('"');
        quoted.push_str(value);
        for _ in 0..trailing_backslashes {
            quoted.push('\\');
        }
        quoted.push('"');
        quoted
    }
}

#[cfg(not(windows))]
mod stub {
    pub fn relaunch_secure_wipe(_drive: &str, _result_file: &str) -> Result<(), String> {
        Err("Secure wipe elevation is only supported on Windows".to_string())
    }
}

#[cfg(not(windows))]
pub use stub::relaunch_secure_wipe;
#[cfg(windows)]
pub use windows_impl::relaunch_secure_wipe;
```

- [ ] **Step 2: Wire it into `lib.rs`**

In `crates/wipe/src/lib.rs`, change:

```rust
mod progress;
mod wipe;

pub use progress::{read_progress, WipeProgress, WipeStatus};
pub use wipe::run_wipe;
```

to:

```rust
mod elevation;
mod progress;
mod wipe;

pub use elevation::relaunch_secure_wipe;
pub use progress::{read_progress, WipeProgress, WipeStatus};
pub use wipe::run_wipe;
```

- [ ] **Step 3: Confirm the crate builds and all tests still pass**

Run: `cargo build -p explorer-wipe && cargo test -p explorer-wipe`
Expected: builds successfully, 4 tests pass (unchanged from Task 1).

- [ ] **Step 4: Commit**

```bash
git add crates/wipe/src/elevation.rs crates/wipe/src/lib.rs
git commit -m "Add the elevated secure-wipe relaunch"
```

---

### Task 4: `main.rs` dispatch for `--secure-wipe`

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the crate dependency**

In `apps/desktop/src-tauri/Cargo.toml`, add to the `[dependencies]` section, alongside the other
`explorer-*` path dependencies:

```toml
explorer-wipe = { path = "../../../crates/wipe" }
```

- [ ] **Step 2: Write the failing tests**

In `apps/desktop/src-tauri/src/main.rs`, add to the `tests` module, after the existing
`recovery_scan_flag_missing_a_required_argument_yields_none` test:

```rust
    #[test]
    fn normal_launch_is_not_secure_wipe() {
        let args = vec!["krampus-explorer.exe".to_string()];
        assert_eq!(parse_secure_wipe_args(&args), None);
    }

    #[test]
    fn secure_wipe_flag_extracts_both_arguments() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--secure-wipe".to_string(),
            "--drive=I:".to_string(),
            "--result-file=C:\\Temp\\wipe-progress.json".to_string(),
        ];
        assert_eq!(
            parse_secure_wipe_args(&args),
            Some(SecureWipeArgs {
                drive: "I:".to_string(),
                result_file: "C:\\Temp\\wipe-progress.json".to_string(),
            })
        );
    }

    #[test]
    fn secure_wipe_flag_missing_a_required_argument_yields_none() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--secure-wipe".to_string(),
            "--drive=I:".to_string(),
        ];
        assert_eq!(parse_secure_wipe_args(&args), None);
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test -p krampus-explorer secure_wipe`
Expected: FAIL -- `parse_secure_wipe_args`/`SecureWipeArgs` don't exist yet.

- [ ] **Step 4: Implement**

In `apps/desktop/src-tauri/src/main.rs`, change the `fn main()` function from:

```rust
fn main() {
    let args: Vec<String> = std::env::args().collect();

    if let Some(recovery_args) = parse_recovery_scan_args(&args) {
        krampus_explorer_lib::run_recovery_scan(
            recovery_args.drive,
            recovery_args.destination,
            recovery_args.file_types,
            recovery_args.result_file,
        );
        return;
    }

    match parse_elevated_terminal_args(&args) {
        Some(cwd) => krampus_explorer_lib::run_elevated_terminal(cwd),
        None => krampus_explorer_lib::run(),
    }
}
```

to:

```rust
fn main() {
    let args: Vec<String> = std::env::args().collect();

    if let Some(wipe_args) = parse_secure_wipe_args(&args) {
        krampus_explorer_lib::run_secure_wipe(wipe_args.drive, wipe_args.result_file);
        return;
    }

    if let Some(recovery_args) = parse_recovery_scan_args(&args) {
        krampus_explorer_lib::run_recovery_scan(
            recovery_args.drive,
            recovery_args.destination,
            recovery_args.file_types,
            recovery_args.result_file,
        );
        return;
    }

    match parse_elevated_terminal_args(&args) {
        Some(cwd) => krampus_explorer_lib::run_elevated_terminal(cwd),
        None => krampus_explorer_lib::run(),
    }
}
```

Then add, right after the `parse_recovery_scan_args` function (before its `#[cfg(test)]` module
starts):

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
struct SecureWipeArgs {
    drive: String,
    result_file: String,
}

/// Parses `--secure-wipe` and its two required arguments out of the process's command-line
/// arguments. Returns `None` for a normal app launch, or if `--secure-wipe` is present but
/// missing either required argument. See `explorer_wipe::relaunch_secure_wipe` for what
/// constructs this command line.
fn parse_secure_wipe_args(args: &[String]) -> Option<SecureWipeArgs> {
    if !args.iter().any(|a| a == "--secure-wipe") {
        return None;
    }
    let drive = args.iter().find_map(|a| a.strip_prefix("--drive=").map(String::from))?;
    let result_file =
        args.iter().find_map(|a| a.strip_prefix("--result-file=").map(String::from))?;

    Some(SecureWipeArgs { drive, result_file })
}
```

- [ ] **Step 5: Add `run_secure_wipe` to `lib.rs`**

In `apps/desktop/src-tauri/src/lib.rs`, add after the existing `run_recovery_scan` function (at
the end of the file):

```rust

/// Entry point for the secure-wipe relaunch (see `explorer_wipe::relaunch_secure_wipe` and
/// `main.rs`'s `--secure-wipe` flag). Runs the wipe directly and exits -- no Tauri, no window,
/// no webview. Progress and the final result are communicated back to the original (unelevated)
/// app process only through the JSON file at `result_file`, which it polls via the
/// `get_wipe_progress` Tauri command.
pub fn run_secure_wipe(drive: String, result_file: String) {
    if let Err(e) = explorer_wipe::run_wipe(&drive, &result_file) {
        eprintln!("Secure wipe failed: {e}");
        std::process::exit(1);
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p krampus-explorer`
Expected: PASS, 9 tests in `main.rs`'s test module (6 existing + 3 new).

- [ ] **Step 7: Confirm the whole workspace builds**

Run: `cargo build --workspace`
Expected: builds successfully.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/src/main.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "Add --secure-wipe headless dispatch"
```

---

### Task 5: Tauri commands `start_secure_wipe` and `get_wipe_progress`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the commands**

In `apps/desktop/src-tauri/src/commands.rs`, add near the top, alongside the other `use` lines:

```rust
use explorer_wipe::{read_progress as read_wipe_progress, relaunch_secure_wipe, WipeProgress};
```

(Aliased to `read_wipe_progress` since `read_progress` from `explorer_recovery` is already
imported in this file for `get_recovery_progress` -- Rust doesn't allow two same-named imports.)

Then add, after the existing `format_drive` command:

```rust
#[tauri::command]
pub fn start_secure_wipe(drive: String) -> Result<String, String> {
    let wipe_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string());
    let result_file = std::env::temp_dir()
        .join(format!("krampus-wipe-{wipe_id}.json"))
        .to_string_lossy()
        .to_string();
    relaunch_secure_wipe(&drive, &result_file)?;
    Ok(result_file)
}

#[tauri::command]
pub fn get_wipe_progress(wipe_id: String) -> Result<WipeProgress, String> {
    read_wipe_progress(std::path::Path::new(&wipe_id))
}
```

- [ ] **Step 2: Register the commands**

In `apps/desktop/src-tauri/src/lib.rs`, find the `commands::format_drive,` line and add right
after it:

```rust
            commands::format_drive,
            commands::start_secure_wipe,
            commands::get_wipe_progress,
```

- [ ] **Step 3: Confirm the whole workspace builds**

Run: `cargo build --workspace`
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "Add Tauri commands for starting and polling a secure wipe"
```

---

### Task 6: Plugin API — `fs.wipe`

**Files:**
- Modify: `apps/desktop/src/types/plugin.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.test.ts`

- [ ] **Step 1: Add the new type and `PluginApi` methods to `types/plugin.ts`**

In `apps/desktop/src/types/plugin.ts`, add right after the existing `RecoveryProgress`
interface:

```ts
export interface WipeProgress {
  status: "running" | "completed" | "failed";
  bytesWritten: number;
  totalBytes: number;
  /** Present only when `status` is `"failed"`. */
  error: string | null;
}
```

Then add to `PluginApi`, right after `formatDrive`:

```ts
  /** Present only if the plugin's manifest declares the "fs.wipe" permission. Starts a secure
   * wipe of `drive` (e.g. "I:") -- overwrites the entire volume with zeros. Triggers a Windows
   * UAC elevation prompt -- the wipe runs in a separate, elevated process. Refuses (rejected
   * promise) if `drive` is the system drive. Resolves to an opaque wipe id to pass to
   * `getWipeProgress`; does not wait for the wipe itself to finish. **Irreversible.** */
  startSecureWipe?: (drive: string) => Promise<string>;
  /** Present only if the plugin's manifest declares the "fs.wipe" permission. Polls the current
   * state of a wipe started via `startSecureWipe`. Rejects if called before the elevated process
   * has written its first progress update -- callers should tolerate a brief initial failure
   * window rather than treating it as fatal. */
  getWipeProgress?: (wipeId: string) => Promise<WipeProgress>;
```

- [ ] **Step 2: Write the failing tests**

In `apps/desktop/src/plugins/pluginApi.test.ts`:

1. Add `WipeProgress` to the type-only import from `../types/plugin`.
2. Add to the `handlers()` mock, right after `formatDrive`:

```ts
    startSecureWipe: vi.fn().mockResolvedValue("C:\\Temp\\krampus-wipe-123.json"),
    getWipeProgress: vi.fn().mockResolvedValue({
      status: "running",
      bytesWritten: 0,
      totalBytes: 100,
      error: null,
    } satisfies WipeProgress),
```

3. Add `"fs.wipe"` to `ALL_PERMISSIONS`.
4. Add to `ALL_METHODS`, right after `"formatDrive"`:

```ts
    "startSecureWipe",
    "getWipeProgress",
```

5. Add a new row to the `it.each` table, right after the `fs.format` row:

```ts
    ["fs.wipe", ["startSecureWipe", "getWipeProgress"]],
```

6. Add two dedicated forwarding tests, after the existing `formatDrive calls the handler with the
   drive` test:

```ts
  it("startSecureWipe calls the handler with the drive", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["fs.wipe"]), h);

    await api.startSecureWipe?.("I:");

    expect(h.startSecureWipe).toHaveBeenCalledWith("I:");
  });

  it("getWipeProgress calls the handler with the wipe id", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["fs.wipe"]), h);

    await api.getWipeProgress?.("C:\\Temp\\krampus-wipe-123.json");

    expect(h.getWipeProgress).toHaveBeenCalledWith("C:\\Temp\\krampus-wipe-123.json");
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npm test -- --run pluginApi`
Expected: FAIL -- `startSecureWipe`/`getWipeProgress` don't exist on `PluginApiHandlers` yet.

- [ ] **Step 4: Wire `pluginApi.ts`**

In `apps/desktop/src/plugins/pluginApi.ts`:

1. Add `WipeProgress` to the type-only import from `../types/plugin`.
2. Add to `PluginApiHandlers`, right after `formatDrive`:

```ts
  startSecureWipe: (drive: string) => Promise<string>;
  getWipeProgress: (wipeId: string) => Promise<WipeProgress>;
```

3. Add to `createPluginApi`, right after the `fs.format` block:

```ts
  if (has("fs.wipe")) {
    api.startSecureWipe = (drive) => handlers.startSecureWipe(drive);
    api.getWipeProgress = (wipeId) => handlers.getWipeProgress(wipeId);
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
git commit -m "Add fs.wipe to the plugin permission system"
```

---

### Task 7: Real handler wiring in `usePluginStore.ts`

**Files:**
- Modify: `apps/desktop/src/stores/usePluginStore.ts`

- [ ] **Step 1: Add the real handlers**

In `apps/desktop/src/stores/usePluginStore.ts`:

1. Add `WipeProgress` to the type-only import from `../types/plugin`.
2. Find the line starting `formatDrive: (drive) =>` and add right after its closing `,`:

```ts
          startSecureWipe: (drive) => invoke<string>("start_secure_wipe", { drive }),
          getWipeProgress: (wipeId) => invoke<WipeProgress>("get_wipe_progress", { wipeId }),
```

- [ ] **Step 2: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/stores/usePluginStore.ts
git commit -m "Wire real startSecureWipe and getWipeProgress handlers into usePluginStore"
```

---

### Task 8: The `examples/plugins/secure-wipe/` plugin

**Files:**
- Create: `examples/plugins/secure-wipe/manifest.json`
- Create: `examples/plugins/secure-wipe/frontend/index.js`
- Create: `examples/plugins/secure-wipe/README.md`

- [ ] **Step 1: Create the manifest**

Create `examples/plugins/secure-wipe/manifest.json`:

```json
{
  "id": "secure-wipe",
  "name": "Secure Wipe",
  "version": "1.0.0",
  "author": "Krampus Explorer",
  "permissions": ["ui.sidebar", "system.drives", "fs.format", "fs.wipe"],
  "entry": "frontend/index.js"
}
```

(`fs.format` is declared for its `getSystemDrive` method only -- this plugin never calls
`formatDrive`.)

- [ ] **Step 2: Create the entry file**

Create `examples/plugins/secure-wipe/frontend/index.js`:

```js
// Entry point for the "Secure Wipe" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", listDrives: "system.drives", getSystemDrive:
// "fs.format", startSecureWipe/getWipeProgress: "fs.wipe").
//
// Unlike Drive Format, there is no native OS dialog backstopping this action -- this plugin's
// own typed-drive-letter confirmation IS the real safety gate, so there's no separate
// api.confirm() step here.

const POLL_INTERVAL_MS = 1000;

function formatSize(bytes) {
  if (bytes === null) return "unknown size";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

api.registerSidebarPanel({
  id: "secure-wipe",
  title: "Secure Wipe",
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
    warning.textContent =
      "Securely erases a drive with a single zero-fill pass. This cannot be undone. " +
      "On SSDs, wear-leveling means this cannot guarantee the old data is truly unrecoverable -- " +
      "for guaranteed SSD erasure, use the drive manufacturer's own secure-erase tool.";

    const driveSelect = document.createElement("select");
    driveSelect.style.padding = "4px 6px";
    driveSelect.style.fontSize = "12px";

    const confirmLabel = document.createElement("label");
    confirmLabel.style.display = "flex";
    confirmLabel.style.flexDirection = "column";
    confirmLabel.style.gap = "2px";
    confirmLabel.style.fontSize = "11px";
    confirmLabel.style.color = "var(--fg-muted)";

    const confirmInput = document.createElement("input");
    confirmInput.type = "text";
    confirmInput.style.padding = "4px 6px";
    confirmInput.style.fontSize = "12px";
    confirmInput.placeholder = "Type the drive letter to confirm";

    const wipeBtn = document.createElement("button");
    wipeBtn.textContent = "Securely Wipe Drive";
    wipeBtn.style.padding = "5px 10px";
    wipeBtn.style.fontSize = "12px";
    wipeBtn.style.cursor = "pointer";
    wipeBtn.disabled = true;

    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    let drives = [];
    let pollHandle = null;

    function selectedDrive() {
      return drives.find((d) => d.name === driveSelect.value) ?? null;
    }

    function updateConfirmLabel() {
      const drive = selectedDrive();
      confirmLabel.textContent = drive ? `Type "${drive.name}" to confirm` : "";
    }

    function updateWipeButton() {
      const drive = selectedDrive();
      const typed = confirmInput.value.trim().toUpperCase();
      wipeBtn.disabled = !drive || typed !== drive.name.toUpperCase();
    }

    async function loadDrives() {
      try {
        const [allDrives, systemDrive] = await Promise.all([api.listDrives(), api.getSystemDrive()]);
        const normalizedSystemDrive = systemDrive?.replace(/\\$/, "").toUpperCase() ?? null;
        drives = allDrives.filter((d) => d.name.toUpperCase() !== normalizedSystemDrive);

        driveSelect.innerHTML = "";
        if (drives.length === 0) {
          setStatus("No non-system drives found.", false);
          return;
        }
        for (const drive of drives) {
          const option = document.createElement("option");
          option.value = drive.name;
          option.textContent = `${drive.name} (${formatSize(drive.totalBytes)})`;
          driveSelect.appendChild(option);
        }
        updateConfirmLabel();
        updateWipeButton();
        setStatus("", false);
      } catch (error) {
        setStatus(String(error), true);
      }
    }

    driveSelect.addEventListener("change", () => {
      confirmInput.value = "";
      updateConfirmLabel();
      updateWipeButton();
    });
    confirmInput.addEventListener("input", updateWipeButton);

    function stopPolling() {
      if (pollHandle !== null) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    }

    function pollProgress(wipeId, driveName) {
      pollHandle = setInterval(async () => {
        let progress;
        try {
          progress = await api.getWipeProgress(wipeId);
        } catch {
          // The elevated process may not have written its first progress update yet --
          // tolerate this rather than treating it as a fatal error.
          return;
        }

        const percent =
          progress.totalBytes > 0
            ? Math.min(100, Math.round((progress.bytesWritten / progress.totalBytes) * 100))
            : 0;

        if (progress.status === "running") {
          setStatus(`Wiping… ${percent}%`, false);
        } else if (progress.status === "completed") {
          stopPolling();
          setStatus(`Drive ${driveName} was securely wiped.`, false);
        } else if (progress.status === "failed") {
          stopPolling();
          setStatus(progress.error ?? "Secure wipe failed.", true);
        }
      }, POLL_INTERVAL_MS);
    }

    wipeBtn.addEventListener("click", async () => {
      const drive = selectedDrive();
      if (!drive) return;

      wipeBtn.disabled = true;
      driveSelect.disabled = true;
      confirmInput.disabled = true;
      setStatus("Starting… (approve the Administrator prompt if one appears)", false);
      try {
        const wipeId = await api.startSecureWipe(drive.name);
        pollProgress(wipeId, drive.name);
      } catch (error) {
        setStatus(String(error), true);
        driveSelect.disabled = false;
        confirmInput.disabled = false;
        updateWipeButton();
      }
    });

    container.appendChild(warning);
    container.appendChild(driveSelect);
    confirmLabel.appendChild(confirmInput);
    container.appendChild(confirmLabel);
    container.appendChild(wipeBtn);
    container.appendChild(status);

    void loadDrives();

    return () => {
      stopPolling();
    };
  },
});
```

- [ ] **Step 3: Create the README**

Create `examples/plugins/secure-wipe/README.md`:

```md
# Secure Wipe

Sidebar panel that securely erases a drive with a single zero-fill pass over its raw bytes.
Requires Administrator elevation (a UAC prompt appears when you start a wipe). **Permanently and
irreversibly destroys all data on the drive.**

Unlike the Drive Format plugin, there is no native Windows dialog acting as a second safety
gate -- this plugin's own typed-drive-letter confirmation (you must type the exact drive letter,
e.g. "I", before the wipe button enables) is the real safety gate.

On SSDs, wear-leveling means an application-level overwrite like this cannot guarantee the old
data is truly unrecoverable -- for guaranteed SSD erasure, use the drive manufacturer's own
firmware-level secure-erase tool instead.

After wiping, the drive is left raw/unformatted (its filesystem structure was part of what got
overwritten). Use the Drive Format plugin afterward if you want to reuse the drive.

## Permissions

- `ui.sidebar` — registers the panel.
- `system.drives` — lists available drives for the drive picker.
- `fs.format` — used only for `getSystemDrive`, to exclude it from the picker.
- `fs.wipe` — starts the elevated wipe and polls its progress.
```

- [ ] **Step 4: Typecheck and run the full frontend test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass. (The new plugin's `frontend/index.js` isn't covered by
this -- it's runtime-loaded example plugin code, no build step, matching every other example
plugin's lack of automated coverage.)

- [ ] **Step 5: Commit**

```bash
git add examples/plugins/secure-wipe/
git commit -m "Add the Secure Wipe example plugin"
```

---

### Task 9: Docs and marketplace listing

**Files:**
- Modify: `docs/plugins.md`
- Modify: `marketplace.json`

- [ ] **Step 1: Document the new permission in `docs/plugins.md`**

Add a new row to the permissions table, right after the `fs.format` row:

```md
| `fs.wipe` | `api.startSecureWipe(drive)`, `api.getWipeProgress(wipeId)` |
```

Then add a new section after the `### \`fs.format\` methods` section's closing paragraph:

```md
### `fs.wipe` methods

- `startSecureWipe(drive: string): Promise<string>` — starts a secure wipe of `drive` (e.g.
  `"I:"`), overwriting the entire volume with a single zero-fill pass. **Permanently and
  irreversibly destroys all data on the drive.** Triggers a Windows UAC elevation prompt -- the
  wipe itself runs in a separate, elevated process, since raw volume writes require
  Administrator rights. Refuses (rejected promise) if `drive` is the system drive. Resolves to
  an opaque wipe id (pass it to `getWipeProgress` verbatim) once the elevated process has been
  launched -- it does not wait for the wipe to finish.
- `getWipeProgress(wipeId: string): Promise<WipeProgress>` — polls the current state of a wipe
  started via `startSecureWipe`. `WipeProgress` has `status` (`"running"` | `"completed"` |
  `"failed"`), `bytesWritten`, `totalBytes`, and `error` (only set when `status` is `"failed"`).
  Rejects if called before the elevated process has written its first progress update -- a brief
  window right after starting, not a real error; callers should tolerate it rather than treating
  it as fatal.

On SSDs, wear-leveling means an application-level overwrite like this cannot guarantee old data
is truly unrecoverable -- true secure erase for SSDs requires the drive's own firmware-level ATA
Secure Erase command, which this does not implement. After wiping, the drive is left
raw/unformatted; use `fs.format`'s `formatDrive` afterward if you want to reuse it.
```

- [ ] **Step 2: Add the new example plugin to the intro list**

In `docs/plugins.md`, find the `drive-format` bullet and add right after it:

```md
- `examples/plugins/secure-wipe/` — single-pass zero-fill secure erase via `fs.wipe`
```

- [ ] **Step 3: Add to `marketplace.json`**

In `marketplace.json` (repo root), add an entry after the `drive-format` entry:

```json
  {
    "id": "secure-wipe",
    "name": "Secure Wipe",
    "description": "Securely erases a drive with a zero-fill pass. Permanently destroys data."
  }
```

- [ ] **Step 4: Validate the JSON and typecheck**

Run: `node -e "JSON.parse(require('fs').readFileSync('marketplace.json'))" && node -e "JSON.parse(require('fs').readFileSync('examples/plugins/secure-wipe/manifest.json'))"`
Expected: no output (both parse successfully).

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add docs/plugins.md marketplace.json
git commit -m "Document fs.wipe and list the new plugin in the marketplace"
```

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full Rust workspace verification**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: fmt makes no unexpected changes (or auto-fixes formatting -- if it changes anything,
commit that separately as `git commit -m "Run cargo fmt"`), clippy is clean, all tests pass
(including the 4 new `explorer-wipe` tests and the 3 new `main.rs` tests).

- [ ] **Step 2: Full frontend verification**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: all green.

- [ ] **Step 3: Manual verification (cannot be automated) -- use the spare USB stick, never a real data drive**

`wipe.rs` and `elevation.rs` have no automated coverage (per Tasks 2-3's intros), and this is the
single most destructive plugin built this session, so verify by hand with extra care.

1. Install/sync the Secure Wipe plugin (via the marketplace, or copy
   `examples/plugins/secure-wipe/` into your local plugins directory and use the "Local Plugins
   (dev)" sync tool in Settings if iterating locally).
2. Open the plugin panel. Confirm the drive dropdown **does NOT include the system drive** --
   the single most important check, same as Drive Format's Task 8. If it appears, stop and treat
   this as a critical bug.
3. Confirm the SSD warning is visible without needing to click anything.
4. Select the spare USB stick. Confirm the "Type ... to confirm" label shows the correct drive
   letter, and that the **Securely Wipe Drive** button stays disabled while the text field is
   empty or contains anything other than an exact match (try a lowercase version, a wrong letter,
   and a partial match -- all should keep it disabled).
5. Type the correct letter. Confirm the button becomes enabled only now.
6. **Actually completing a real wipe is optional and your call** -- only do it if you're
   deliberately testing against the spare stick and are fine permanently losing its contents. If
   you do: click the button, approve the UAC prompt, confirm the progress percentage climbs, and
   confirm the final status shows "Drive \<letter\> was securely wiped." Afterward, check the
   drive in the core file explorer or Windows' own Disk Management -- it should show as
   unformatted/RAW, not with its previous filesystem contents.

- [ ] **Step 4: Report any failures as real bugs to fix**, not to note-and-move-past. Step 3.2
  (system drive must never appear in the dropdown) is correctness-critical, not a nice-to-have --
  if it fails, stop and fix it before considering this plugin done.
