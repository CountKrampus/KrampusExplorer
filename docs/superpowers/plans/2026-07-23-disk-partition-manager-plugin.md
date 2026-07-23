# Disk Partition Manager Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Disk Partition Manager plugin — a proportional visual disk map (view/new/delete/resize/format/relabel partitions) backed by Windows' own PowerShell `Storage` module, with the whole physical disk holding Windows locked read-only and Secure-Wipe-style typed confirmation on every destructive action.

**Architecture:** A new `crates/partitions` crate wraps `Get-Disk`/`Get-Partition`/`Get-Volume`/`New-Partition`/`Remove-Partition`/`Resize-Partition`/`Format-Volume`/`Set-Partition` via `powershell.exe` subprocesses — unelevated for the read-only listing, elevated (one UAC prompt per action, via `ShellExecuteExW` + `WaitForSingleObject` rather than the headless-relaunch-of-our-own-exe pattern used by Recovery/Wipe) for every mutation. New Tauri commands expose it under a new `system.partitions` plugin permission; a new example plugin renders the disk map and wires up the confirmation flows.

**Tech Stack:** Rust (`windows-sys` for `ShellExecuteExW`/`WaitForSingleObject`), `powershell.exe` + `ConvertTo-Json`, Tauri commands, vanilla JS example plugin (matches every other example plugin in this codebase — no framework).

**Reference:** `docs/superpowers/specs/2026-07-23-disk-partition-manager-plugin-design.md` (read this first — it explains *why* every safety decision below was made).

---

### Task 1: `crates/partitions` scaffolding and the `DiskInfo`/`PartitionInfo` model

**Files:**
- Create: `crates/partitions/Cargo.toml`
- Create: `crates/partitions/src/lib.rs`
- Create: `crates/partitions/src/model.rs`

- [ ] **Step 1: Create the crate's `Cargo.toml`**

```toml
[package]
name = "explorer-partitions"
version.workspace = true
edition.workspace = true
license.workspace = true

[lib]
name = "explorer_partitions"
path = "src/lib.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
explorer-filesystem = { path = "../filesystem" }

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.61", features = [
    "Win32_UI_Shell",
    "Win32_System_Registry",
    "Win32_System_Threading",
    "Win32_Foundation",
] }
```

`Win32_System_Registry` is required alongside `Win32_UI_Shell` because `SHELLEXECUTEINFOW`'s `hkeyClass` field (and therefore `ShellExecuteExW` itself) is only compiled into `windows-sys` under that feature — confirmed by reading the vendored `windows-sys` v0.61.2 source directly (`src/Windows/Win32/UI/Shell/mod.rs`, the `ShellExecuteExW` binding and `SHELLEXECUTEINFOW` struct are both behind `#[cfg(feature = "Win32_System_Registry")]`), the same rigor this session has applied to every other `windows-sys` feature addition.

- [ ] **Step 2: Write `model.rs` with its round-trip tests**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PartitionInfo {
    pub drive_letter: Option<String>,
    pub size_bytes: u64,
    pub offset_bytes: u64,
    pub filesystem: Option<String>,
    pub partition_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub number: u32,
    pub total_bytes: u64,
    pub is_system: bool,
    pub model: String,
    pub partitions: Vec<PartitionInfo>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partition_info_round_trips_through_json() {
        let original = PartitionInfo {
            drive_letter: Some("D:".to_string()),
            size_bytes: 500_000_000_000,
            offset_bytes: 1_048_576,
            filesystem: Some("NTFS".to_string()),
            partition_type: "Basic".to_string(),
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: PartitionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn partition_info_round_trips_with_no_drive_letter_or_filesystem() {
        let original = PartitionInfo {
            drive_letter: None,
            size_bytes: 104_857_600,
            offset_bytes: 0,
            filesystem: None,
            partition_type: "Reserved".to_string(),
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: PartitionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn disk_info_round_trips_with_multiple_partitions() {
        let original = DiskInfo {
            number: 0,
            total_bytes: 512_000_000_000,
            is_system: true,
            model: "Samsung SSD 970 EVO".to_string(),
            partitions: vec![
                PartitionInfo {
                    drive_letter: None,
                    size_bytes: 104_857_600,
                    offset_bytes: 1_048_576,
                    filesystem: Some("FAT32".to_string()),
                    partition_type: "System".to_string(),
                },
                PartitionInfo {
                    drive_letter: Some("C:".to_string()),
                    size_bytes: 511_000_000_000,
                    offset_bytes: 106_954_752,
                    filesystem: Some("NTFS".to_string()),
                    partition_type: "Basic".to_string(),
                },
            ],
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: DiskInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn disk_info_round_trips_with_no_partitions() {
        let original = DiskInfo {
            number: 1,
            total_bytes: 1_000_000_000_000,
            is_system: false,
            model: "WD Blue".to_string(),
            partitions: vec![],
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: DiskInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }
}
```

- [ ] **Step 3: Write `lib.rs` (module declarations only for now)**

```rust
//! Windows disk partition management -- view, create, delete, resize, format, and relabel
//! partitions via PowerShell's `Storage` module. Read-only listing runs unelevated; every
//! mutation elevates `powershell.exe` per-operation (see `elevation.rs`) and refuses up front if
//! the target disk holds the Windows/system partition (see `system_disk.rs`).

mod model;

pub use model::{DiskInfo, PartitionInfo};
```

- [ ] **Step 4: Add the crate to the workspace**

Modify `Cargo.toml` (workspace root), adding `"crates/partitions",` to the `members` list, alphabetically after `"crates/plugins"` and before `"crates/preview"` — wait, check the existing order first (`crates/core`, `crates/filesystem`, `crates/search`, `crates/preview`, `crates/plugins`, `crates/settings`, `crates/terminal`, `crates/recovery`, `crates/wipe`, `apps/desktop/src-tauri`). This list isn't alphabetical — it's roughly build/dependency order. Add `"crates/partitions",` right after `"crates/wipe",` (before `apps/desktop/src-tauri`), matching how `crates/wipe` itself was appended after `crates/recovery`:

```toml
[workspace]
resolver = "2"
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
    "crates/partitions",
    "apps/desktop/src-tauri",
]
```

- [ ] **Step 5: Run the tests**

Run: `cargo test -p explorer-partitions`
Expected: 4 tests pass (`partition_info_round_trips_through_json`,
`partition_info_round_trips_with_no_drive_letter_or_filesystem`,
`disk_info_round_trips_with_multiple_partitions`, `disk_info_round_trips_with_no_partitions`).

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml crates/partitions
git commit -m "Add explorer-partitions crate with the DiskInfo/PartitionInfo model"
```

---

### Task 2: `list.rs` — pure JSON-parsing logic, with tests

**Files:**
- Create: `crates/partitions/src/list.rs`
- Modify: `crates/partitions/src/lib.rs`

- [ ] **Step 1: Write `list.rs`'s pure parsing function and its tests**

The real `list_disks()` (Task 3) runs a PowerShell script that already emits JSON shaped exactly
like `Vec<DiskInfo>` (each disk a `[PSCustomObject]` with `number`/`totalBytes`/`isSystem`/`model`/
`partitions`, each partition a `[PSCustomObject]` with `driveLetter`/`sizeBytes`/`offsetBytes`/
`filesystem`/`partitionType`) — so parsing is a direct `serde_json::from_str::<Vec<DiskInfo>>`,
no intermediate representation needed. The one thing worth testing on its own: PowerShell's
`ConvertTo-Json` collapses a single-element array to a bare object unless you wrap the source
in `@(...)` first — the script (Task 3) always does this at both the top level and per-disk
`partitions` level, so this test exists to pin that assumption with a concrete example, not to
re-derive parsing logic.

```rust
use crate::model::DiskInfo;

pub(crate) fn parse_disks_json(json: &str) -> Result<Vec<DiskInfo>, String> {
    let trimmed = json.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(trimmed).map_err(|e| format!("Could not parse disk list: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_two_disks_with_mixed_partition_counts() {
        let json = r#"[
            {
                "number": 0,
                "totalBytes": 512000000000,
                "isSystem": true,
                "model": "Samsung SSD 970 EVO",
                "partitions": [
                    { "driveLetter": null, "sizeBytes": 104857600, "offsetBytes": 1048576, "filesystem": "FAT32", "partitionType": "System" },
                    { "driveLetter": "C:", "sizeBytes": 511000000000, "offsetBytes": 106954752, "filesystem": "NTFS", "partitionType": "Basic" }
                ]
            },
            {
                "number": 1,
                "totalBytes": 1000000000000,
                "isSystem": false,
                "model": "WD Blue",
                "partitions": [
                    { "driveLetter": "D:", "sizeBytes": 1000000000000, "offsetBytes": 1048576, "filesystem": "NTFS", "partitionType": "Basic" }
                ]
            }
        ]"#;

        let disks = parse_disks_json(json).unwrap();

        assert_eq!(disks.len(), 2);
        assert_eq!(disks[0].number, 0);
        assert!(disks[0].is_system);
        assert_eq!(disks[0].partitions.len(), 2);
        assert_eq!(disks[0].partitions[0].drive_letter, None);
        assert_eq!(disks[1].partitions[0].drive_letter, Some("D:".to_string()));
    }

    #[test]
    fn parses_a_disk_with_no_partitions() {
        let json = r#"[{"number":2,"totalBytes":8000000000,"isSystem":false,"model":"USB Drive","partitions":[]}]"#;

        let disks = parse_disks_json(json).unwrap();

        assert_eq!(disks.len(), 1);
        assert!(disks[0].partitions.is_empty());
    }

    #[test]
    fn parses_an_empty_disk_list() {
        assert_eq!(parse_disks_json("[]").unwrap(), Vec::new());
    }

    #[test]
    fn empty_output_parses_as_an_empty_list_rather_than_an_error() {
        // Defensive: if the script somehow produces no stdout at all (rather than "[]"), treat
        // it the same as "no disks found" instead of a parse failure -- an empty machine state
        // shouldn't look like a crash.
        assert_eq!(parse_disks_json("").unwrap(), Vec::new());
        assert_eq!(parse_disks_json("   \n").unwrap(), Vec::new());
    }

    #[test]
    fn rejects_genuinely_malformed_json() {
        assert!(parse_disks_json("{not valid json").is_err());
    }
}
```

- [ ] **Step 2: Add `mod list;` to `lib.rs`**

```rust
mod list;
mod model;

pub use model::{DiskInfo, PartitionInfo};
```

(`list_disks` itself isn't `pub use`d yet — that happens in Task 3, once the real function exists
alongside the pure one.)

- [ ] **Step 3: Run the tests**

Run: `cargo test -p explorer-partitions`
Expected: the 4 tests from Task 1 plus 5 new ones in `list.rs`, all passing.

- [ ] **Step 4: Commit**

```bash
git add crates/partitions/src/list.rs crates/partitions/src/lib.rs
git commit -m "Add pure disk-list JSON parsing to explorer-partitions"
```

---

### Task 3: `list.rs` — the real `list_disks()`

**Files:**
- Modify: `crates/partitions/src/list.rs`
- Modify: `crates/partitions/src/lib.rs`

- [ ] **Step 1: Add the PowerShell script and the real `list_disks()` function**

No test for this step — it spawns a real `powershell.exe` process and queries real hardware,
matching this session's established precedent for every other real-OS-touching function
(`format_drive`, `run_wipe`, `relaunch_recovery_scan`, etc. all have zero automated tests; only
the pure logic around them does).

Add to the top of `crates/partitions/src/list.rs`, above `parse_disks_json`:

```rust
use std::process::Command;

/// Lists every physical disk and its partitions. Runs **unelevated** -- `Get-Disk`/
/// `Get-Partition`/`Get-Volume` are read-only queries that don't need Administrator, unlike every
/// mutating operation in `actions.rs`. The script builds its own `[PSCustomObject]`s with field
/// names matching `DiskInfo`/`PartitionInfo` exactly (`ConvertTo-Json`'s camelCase-friendly
/// property names come straight from these names, not from .NET's own PascalCase members), so
/// parsing on the Rust side is a direct deserialization with no intermediate mapping step.
pub fn list_disks() -> Result<Vec<DiskInfo>, String> {
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", LIST_DISKS_SCRIPT])
        .output()
        .map_err(|e| format!("Could not run PowerShell: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Could not list disks: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    parse_disks_json(&String::from_utf8_lossy(&output.stdout))
}

/// Wraps both the top-level disk collection and each disk's `partitions` collection in `@(...)`
/// so `ConvertTo-Json` always emits an array, even when there's exactly one disk or exactly one
/// partition -- without this, PowerShell collapses a single-element array to a bare JSON object,
/// which would fail to deserialize as `Vec<DiskInfo>`/`Vec<PartitionInfo>`.
const LIST_DISKS_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$systemLetter = $env:SystemDrive.TrimEnd(':')
$systemDiskNumber = (Get-Partition -DriveLetter $systemLetter -ErrorAction SilentlyContinue).DiskNumber

$disks = Get-Disk | ForEach-Object {
    $disk = $_
    $partitions = @(Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | ForEach-Object {
        $part = $_
        $volume = if ($part.DriveLetter) { Get-Volume -DriveLetter $part.DriveLetter -ErrorAction SilentlyContinue } else { $null }
        [PSCustomObject]@{
            driveLetter   = if ($part.DriveLetter) { "$($part.DriveLetter):" } else { $null }
            sizeBytes     = $part.Size
            offsetBytes   = $part.Offset
            filesystem    = if ($volume) { $volume.FileSystem } else { $null }
            partitionType = $part.Type.ToString()
        }
    })
    [PSCustomObject]@{
        number     = $disk.Number
        totalBytes = $disk.Size
        isSystem   = ($null -ne $systemDiskNumber -and $disk.Number -eq $systemDiskNumber)
        model      = $disk.FriendlyName
        partitions = $partitions
    }
}
@($disks) | ConvertTo-Json -Depth 6
"#;
```

- [ ] **Step 2: Export `list_disks` from `lib.rs`**

```rust
mod list;
mod model;

pub use list::list_disks;
pub use model::{DiskInfo, PartitionInfo};
```

- [ ] **Step 3: Run the existing tests to confirm nothing broke**

Run: `cargo test -p explorer-partitions`
Expected: the same 9 tests from Tasks 1-2 still pass (this step adds no new tests).

- [ ] **Step 4: Commit**

```bash
git add crates/partitions/src/list.rs crates/partitions/src/lib.rs
git commit -m "Add the real list_disks() PowerShell query to explorer-partitions"
```

---

### Task 4: `system_disk.rs` — resolving the system disk number

**Files:**
- Create: `crates/partitions/src/system_disk.rs`
- Modify: `crates/partitions/src/lib.rs`

- [ ] **Step 1: Write `system_disk.rs`**

No automated test (real process spawn) — matches this crate's established precedent from Task 3.

```rust
use std::process::Command;

/// Resolves the physical disk number that owns the Windows/system partition, by combining
/// `explorer_filesystem::get_system_drive()` (already-tested logic, reused rather than
/// re-derived -- the same one-source-of-truth pattern Drive Format and Secure Wipe both follow)
/// with a fresh PowerShell lookup of which disk that drive letter lives on.
///
/// Returns `Ok(None)` -- not an error -- if the system drive letter can't be resolved to a disk
/// number. Callers (see `actions.rs`'s `ensure_not_system_disk`) must treat `None` as "unknown,
/// therefore not provably safe," never as "no system disk exists, so anything goes."
pub fn resolve_system_disk_number() -> Result<Option<u32>, String> {
    let letter = match explorer_filesystem::get_system_drive() {
        Some(l) => l.trim_end_matches('\\').trim_end_matches(':').to_string(),
        None => return Ok(None),
    };

    let script =
        format!("(Get-Partition -DriveLetter '{letter}' -ErrorAction SilentlyContinue).DiskNumber");

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("Could not run PowerShell: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Could not resolve the system disk: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return Ok(None);
    }
    text.parse::<u32>()
        .map(Some)
        .map_err(|e| format!("Could not parse disk number '{text}': {e}"))
}
```

- [ ] **Step 2: Add `mod system_disk;` to `lib.rs`**

```rust
mod list;
mod model;
mod system_disk;

pub use list::list_disks;
pub use model::{DiskInfo, PartitionInfo};
pub use system_disk::resolve_system_disk_number;
```

- [ ] **Step 3: Run the tests to confirm nothing broke**

Run: `cargo test -p explorer-partitions`
Expected: the same 9 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add crates/partitions/src/system_disk.rs crates/partitions/src/lib.rs
git commit -m "Add system-disk resolution to explorer-partitions"
```

---

### Task 5: `actions.rs` — script-building pure functions, with tests

**Files:**
- Create: `crates/partitions/src/actions.rs`
- Modify: `crates/partitions/src/lib.rs`

- [ ] **Step 1: Write the pure script-building functions and their tests**

Each function builds the exact PowerShell fragment for one operation. These assign their outcome
to a `$result` variable (a JSON string) rather than emitting it directly, because `elevation.rs`
(Task 6) wraps whatever these return inside a `try`/`catch` that captures `$result` into the
result file -- see that task for the full wrapping. Building these as pure string functions (no
process spawning) is what makes them testable at all.

```rust
/// Every mutating action's script ends by setting `$result` to a JSON string --
/// `elevation.rs::run_elevated_action` wraps this fragment in a `try`/`catch` that writes
/// `$result` to a file it reads back afterward. Actions that don't naturally produce a
/// `PartitionInfo` (delete, relabel) just set `$result` to `'{}'`.
fn partition_result_expr(disk_number: u32, locator: &str) -> String {
    format!(
        "$p = Get-Partition -DiskNumber {disk_number} {locator}\n\
$v = if ($p.DriveLetter) {{ Get-Volume -DriveLetter $p.DriveLetter -ErrorAction SilentlyContinue }} else {{ $null }}\n\
$result = [PSCustomObject]@{{ driveLetter = if ($p.DriveLetter) {{ \"$($p.DriveLetter):\" }} else {{ $null }}; sizeBytes = $p.Size; offsetBytes = $p.Offset; filesystem = if ($v) {{ $v.FileSystem }} else {{ $null }}; partitionType = $p.Type.ToString() }} | ConvertTo-Json -Compress"
    )
}

pub(crate) fn new_partition_script(
    disk_number: u32,
    offset_bytes: u64,
    size_bytes: u64,
    filesystem: &str,
    drive_letter: Option<&str>,
) -> String {
    let letter_arg = match drive_letter {
        Some(l) => format!("-DriveLetter '{}'", l.trim_end_matches(':').to_uppercase()),
        None => "-AssignDriveLetter".to_string(),
    };
    format!(
        "$p = New-Partition -DiskNumber {disk_number} -Offset {offset_bytes} -Size {size_bytes} {letter_arg}\n\
Format-Volume -Partition $p -FileSystem {filesystem} -Confirm:$false | Out-Null\n\
{}",
        partition_result_expr(disk_number, "-PartitionNumber $p.PartitionNumber")
    )
}

pub(crate) fn delete_partition_script(disk_number: u32, drive_letter: &str) -> String {
    let letter = drive_letter.trim_end_matches(':').to_uppercase();
    format!(
        "Remove-Partition -DiskNumber {disk_number} -DriveLetter '{letter}' -Confirm:$false\n\
$result = '{{}}'"
    )
}

pub(crate) fn resize_partition_script(
    disk_number: u32,
    drive_letter: &str,
    new_size_bytes: u64,
) -> String {
    let letter = drive_letter.trim_end_matches(':').to_uppercase();
    format!(
        "Resize-Partition -DiskNumber {disk_number} -DriveLetter '{letter}' -Size {new_size_bytes}\n\
{}",
        partition_result_expr(disk_number, &format!("-DriveLetter '{letter}'"))
    )
}

pub(crate) fn format_partition_script(
    disk_number: u32,
    drive_letter: &str,
    filesystem: &str,
) -> String {
    let letter = drive_letter.trim_end_matches(':').to_uppercase();
    format!(
        "Format-Volume -DriveLetter '{letter}' -FileSystem {filesystem} -Confirm:$false | Out-Null\n\
{}",
        partition_result_expr(disk_number, &format!("-DriveLetter '{letter}'"))
    )
}

pub(crate) fn set_drive_letter_script(
    disk_number: u32,
    drive_letter: &str,
    new_letter: Option<&str>,
) -> String {
    let letter = drive_letter.trim_end_matches(':').to_uppercase();
    let action = match new_letter {
        Some(new) => format!(
            "Set-Partition -DiskNumber {disk_number} -DriveLetter '{letter}' -NewDriveLetter '{}'",
            new.trim_end_matches(':').to_uppercase()
        ),
        None => format!(
            "Remove-PartitionAccessPath -DiskNumber {disk_number} -DriveLetter '{letter}' -AccessPath '{letter}:\\'"
        ),
    };
    format!("{action}\n$result = '{{}}'")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_partition_script_with_an_explicit_drive_letter() {
        let script = new_partition_script(1, 1_048_576, 500_000_000_000, "NTFS", Some("E:"));
        assert!(script.contains("New-Partition -DiskNumber 1 -Offset 1048576 -Size 500000000000 -DriveLetter 'E'"));
        assert!(script.contains("Format-Volume -Partition $p -FileSystem NTFS -Confirm:$false"));
    }

    #[test]
    fn new_partition_script_without_a_drive_letter_auto_assigns_one() {
        let script = new_partition_script(1, 1_048_576, 500_000_000_000, "NTFS", None);
        assert!(script.contains("-AssignDriveLetter"));
        assert!(!script.contains("-DriveLetter"));
    }

    #[test]
    fn delete_partition_script_targets_the_right_disk_and_letter() {
        let script = delete_partition_script(2, "F:");
        assert!(script.contains("Remove-Partition -DiskNumber 2 -DriveLetter 'F' -Confirm:$false"));
        assert!(script.contains("$result = '{}'"));
    }

    #[test]
    fn resize_partition_script_sets_the_new_size() {
        let script = resize_partition_script(0, "C:", 600_000_000_000);
        assert!(script.contains("Resize-Partition -DiskNumber 0 -DriveLetter 'C' -Size 600000000000"));
    }

    #[test]
    fn format_partition_script_uses_the_requested_filesystem() {
        let script = format_partition_script(1, "D:", "exFAT");
        assert!(script.contains("Format-Volume -DriveLetter 'D' -FileSystem exFAT -Confirm:$false"));
    }

    #[test]
    fn set_drive_letter_script_reassigns_to_a_new_letter() {
        let script = set_drive_letter_script(1, "E:", Some("G:"));
        assert!(script.contains("Set-Partition -DiskNumber 1 -DriveLetter 'E' -NewDriveLetter 'G'"));
    }

    #[test]
    fn set_drive_letter_script_removes_the_letter_when_none_is_given() {
        let script = set_drive_letter_script(1, "E:", None);
        assert!(script.contains("Remove-PartitionAccessPath -DiskNumber 1 -DriveLetter 'E' -AccessPath 'E:\\'"));
    }

    #[test]
    fn drive_letters_are_normalized_to_uppercase_without_a_trailing_colon() {
        let script = delete_partition_script(0, "f:");
        assert!(script.contains("-DriveLetter 'F'"));
    }
}
```

- [ ] **Step 2: Add `mod actions;` to `lib.rs` (not exported yet -- the real functions come in Task 6)**

```rust
mod actions;
mod list;
mod model;
mod system_disk;

pub use list::list_disks;
pub use model::{DiskInfo, PartitionInfo};
pub use system_disk::resolve_system_disk_number;
```

- [ ] **Step 3: Run the tests**

Run: `cargo test -p explorer-partitions`
Expected: the 9 tests from Tasks 1-2 plus 8 new ones in `actions.rs`, all passing.

- [ ] **Step 4: Commit**

```bash
git add crates/partitions/src/actions.rs crates/partitions/src/lib.rs
git commit -m "Add pure partition-action script builders to explorer-partitions"
```

---

### Task 6: `elevation.rs` and the real `actions.rs` functions

**Files:**
- Create: `crates/partitions/src/elevation.rs`
- Modify: `crates/partitions/src/actions.rs`
- Modify: `crates/partitions/src/lib.rs`

- [ ] **Step 1: Write `elevation.rs`**

No automated test (real UAC prompt + elevated process) -- matches every other elevation module in
this codebase (`crates/recovery/src/elevation.rs`, `crates/wipe/src/elevation.rs`).

```rust
//! Elevates `powershell.exe` per-operation to run a single partition-management action,
//! triggering the Windows UAC prompt, and waits for it to finish -- unlike Recovery/Wipe's
//! headless-relaunch-of-our-own-exe-with-polled-progress pattern, appropriate for those
//! multi-minute operations but overkill here, where most actions are near-instant. Uses
//! `ShellExecuteExW` (not the plain `ShellExecuteW` used elsewhere in this codebase) because only
//! the `Ex` variant, given `SEE_MASK_NOCLOSEPROCESS`, hands back a process handle to wait on.

#[cfg(windows)]
mod windows_impl {
    use std::path::PathBuf;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{WaitForSingleObject, INFINITE};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};

    /// Runs `script` (a PowerShell fragment that ends by setting `$result` to a JSON string --
    /// see `actions.rs`) elevated, waits for it to exit, and returns the `$result` text it wrote.
    pub fn run_elevated_action(script: &str) -> Result<String, String> {
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos().to_string())
            .unwrap_or_else(|_| "0".to_string());
        let script_path = std::env::temp_dir().join(format!("krampus-partition-{id}.ps1"));
        let result_path = std::env::temp_dir().join(format!("krampus-partition-{id}-result.json"));
        let error_path = std::env::temp_dir().join(format!("krampus-partition-{id}-error.txt"));

        let wrapped = format!(
            "$ErrorActionPreference = 'Stop'\n\
try {{\n{script}\n$result | Out-File -FilePath '{}' -Encoding utf8 -NoNewline\n}} catch {{\n$_.Exception.Message | Out-File -FilePath '{}' -Encoding utf8 -NoNewline\n}}\n",
            result_path.display(),
            error_path.display(),
        );
        std::fs::write(&script_path, wrapped)
            .map_err(|e| format!("Could not write the operation script: {e}"))?;

        let result = run_elevated_powershell_file(&script_path);

        let _ = std::fs::remove_file(&script_path);

        result?;

        if error_path.exists() {
            let message = std::fs::read_to_string(&error_path).unwrap_or_default();
            let _ = std::fs::remove_file(&error_path);
            return Err(message.trim().to_string());
        }

        let text = std::fs::read_to_string(&result_path)
            .map_err(|e| format!("Could not read the operation's result: {e}"))?;
        let _ = std::fs::remove_file(&result_path);
        Ok(text.trim().to_string())
    }

    fn run_elevated_powershell_file(script_path: &PathBuf) -> Result<(), String> {
        let exe_wide = to_wide("powershell.exe");
        let verb_wide = to_wide("runas");
        let params = format!(
            "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\"",
            script_path.display()
        );
        let params_wide = to_wide(&params);

        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            hwnd: std::ptr::null_mut(),
            lpVerb: verb_wide.as_ptr(),
            lpFile: exe_wide.as_ptr(),
            lpParameters: params_wide.as_ptr(),
            lpDirectory: std::ptr::null(),
            nShow: 1,
            hInstApp: std::ptr::null_mut(),
            lpIDList: std::ptr::null_mut(),
            lpClass: std::ptr::null(),
            hkeyClass: std::ptr::null_mut(),
            dwHotKey: 0,
            Anonymous: unsafe { std::mem::zeroed() },
            hProcess: std::ptr::null_mut(),
        };

        // SAFETY: `info` is fully initialized above -- every pointer field is either null or
        // points at a wide string kept alive on this function's stack for the duration of the
        // call. `ShellExecuteExW` writes a process handle into `info.hProcess` on success.
        let ok = unsafe { ShellExecuteExW(&mut info) };
        if ok == 0 || info.hProcess.is_null() {
            return Err("Elevation was cancelled or could not start".to_string());
        }

        // SAFETY: `info.hProcess` was just returned by the successful ShellExecuteExW call above
        // and hasn't been closed yet.
        unsafe {
            WaitForSingleObject(info.hProcess, INFINITE);
            CloseHandle(info.hProcess);
        }

        Ok(())
    }

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

#[cfg(not(windows))]
mod stub {
    pub fn run_elevated_action(_script: &str) -> Result<String, String> {
        Err("Partition management is only supported on Windows".to_string())
    }
}

#[cfg(not(windows))]
pub use stub::run_elevated_action;
#[cfg(windows)]
pub use windows_impl::run_elevated_action;
```

- [ ] **Step 2: Add the real public functions to `actions.rs`**

Append to `crates/partitions/src/actions.rs` (above the `#[cfg(test)]` module):

```rust
use crate::elevation::run_elevated_action;
use crate::model::PartitionInfo;
use crate::system_disk::resolve_system_disk_number;

/// Refuses (`Err`) if `disk_number` is the physical disk holding the system/boot partition, or
/// if that can't currently be determined. Re-checked fresh on every call rather than trusting a
/// client-supplied `isSystem` flag from a possibly-stale `list_disks()` snapshot -- the backend
/// never relies on the frontend alone to have kept a destructive action off the system disk.
fn ensure_not_system_disk(disk_number: u32) -> Result<(), String> {
    match resolve_system_disk_number()? {
        Some(system_number) if system_number == disk_number => Err(format!(
            "Refusing to modify disk {disk_number} -- it holds the system drive"
        )),
        _ => Ok(()),
    }
}

fn parse_partition_result(json: &str) -> Result<PartitionInfo, String> {
    serde_json::from_str(json).map_err(|e| format!("Could not parse the operation's result: {e}"))
}

pub fn new_partition(
    disk_number: u32,
    offset_bytes: u64,
    size_bytes: u64,
    filesystem: &str,
    drive_letter: Option<&str>,
) -> Result<PartitionInfo, String> {
    ensure_not_system_disk(disk_number)?;
    let json = run_elevated_action(&new_partition_script(
        disk_number,
        offset_bytes,
        size_bytes,
        filesystem,
        drive_letter,
    ))?;
    parse_partition_result(&json)
}

pub fn delete_partition(disk_number: u32, drive_letter: &str) -> Result<(), String> {
    ensure_not_system_disk(disk_number)?;
    run_elevated_action(&delete_partition_script(disk_number, drive_letter))?;
    Ok(())
}

pub fn resize_partition(
    disk_number: u32,
    drive_letter: &str,
    new_size_bytes: u64,
) -> Result<PartitionInfo, String> {
    ensure_not_system_disk(disk_number)?;
    let json = run_elevated_action(&resize_partition_script(disk_number, drive_letter, new_size_bytes))?;
    parse_partition_result(&json)
}

pub fn format_partition(
    disk_number: u32,
    drive_letter: &str,
    filesystem: &str,
) -> Result<PartitionInfo, String> {
    ensure_not_system_disk(disk_number)?;
    let json = run_elevated_action(&format_partition_script(disk_number, drive_letter, filesystem))?;
    parse_partition_result(&json)
}

pub fn set_drive_letter(
    disk_number: u32,
    drive_letter: &str,
    new_letter: Option<&str>,
) -> Result<(), String> {
    ensure_not_system_disk(disk_number)?;
    run_elevated_action(&set_drive_letter_script(disk_number, drive_letter, new_letter))?;
    Ok(())
}
```

- [ ] **Step 3: Wire it all into `lib.rs`**

```rust
mod actions;
mod elevation;
mod list;
mod model;
mod system_disk;

pub use actions::{
    delete_partition, format_partition, new_partition, resize_partition, set_drive_letter,
};
pub use list::list_disks;
pub use model::{DiskInfo, PartitionInfo};
pub use system_disk::resolve_system_disk_number;
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p explorer-partitions`
Expected: the same 17 tests from Tasks 1-5 still pass (this step adds no new tests -- everything
added here does real process spawning and elevation).

- [ ] **Step 5: Run clippy**

Run: `cargo clippy -p explorer-partitions --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add crates/partitions/src/elevation.rs crates/partitions/src/actions.rs crates/partitions/src/lib.rs
git commit -m "Add per-operation elevation and the real partition-action functions"
```

---

### Task 7: Wire `explorer-partitions` into the desktop app

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dependency**

In `apps/desktop/src-tauri/Cargo.toml`, add this line next to the other `explorer-*` path
dependencies (right after `explorer-wipe = { path = "../../../crates/wipe" }`):

```toml
explorer-partitions = { path = "../../../crates/partitions" }
```

- [ ] **Step 2: Confirm the workspace builds**

Run: `cargo build --workspace`
Expected: builds successfully (the crate isn't used by any command yet, so this just confirms the
dependency graph is valid).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml
git commit -m "Add explorer-partitions as a dependency of the desktop app"
```

---

### Task 8: Tauri commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the import**

In `apps/desktop/src-tauri/src/commands.rs`, add to the existing `use explorer_...` import block
(alphabetically, after the `explorer_filesystem` import):

```rust
use explorer_partitions::{DiskInfo, PartitionInfo};
```

- [ ] **Step 2: Add the six commands**

Append to `commands.rs` (after `get_wipe_progress`, keeping the same file-ordering convention this
file already uses of grouping related commands together):

```rust
/// `async` because listing disks shells out to `powershell.exe` and waits for it to exit --
/// `spawn_blocking` keeps that real wait off the async command-handler thread, the same pattern
/// `format_drive` already uses for its own blocking native-dialog wait.
#[tauri::command]
pub async fn list_disks() -> Result<Vec<DiskInfo>, String> {
    tauri::async_runtime::spawn_blocking(explorer_partitions::list_disks)
        .await
        .map_err(|e| format!("Listing disks panicked: {e}"))?
}

#[tauri::command]
pub async fn create_partition(
    disk_number: u32,
    offset_bytes: u64,
    size_bytes: u64,
    filesystem: String,
    drive_letter: Option<String>,
) -> Result<PartitionInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        explorer_partitions::new_partition(
            disk_number,
            offset_bytes,
            size_bytes,
            &filesystem,
            drive_letter.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Create partition task panicked: {e}"))?
}

#[tauri::command]
pub async fn delete_partition(disk_number: u32, drive_letter: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        explorer_partitions::delete_partition(disk_number, &drive_letter)
    })
    .await
    .map_err(|e| format!("Delete partition task panicked: {e}"))?
}

#[tauri::command]
pub async fn resize_partition(
    disk_number: u32,
    drive_letter: String,
    new_size_bytes: u64,
) -> Result<PartitionInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        explorer_partitions::resize_partition(disk_number, &drive_letter, new_size_bytes)
    })
    .await
    .map_err(|e| format!("Resize partition task panicked: {e}"))?
}

#[tauri::command]
pub async fn format_partition(
    disk_number: u32,
    drive_letter: String,
    filesystem: String,
) -> Result<PartitionInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        explorer_partitions::format_partition(disk_number, &drive_letter, &filesystem)
    })
    .await
    .map_err(|e| format!("Format partition task panicked: {e}"))?
}

#[tauri::command]
pub async fn set_drive_letter(
    disk_number: u32,
    current_letter: String,
    new_letter: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        explorer_partitions::set_drive_letter(disk_number, &current_letter, new_letter.as_deref())
    })
    .await
    .map_err(|e| format!("Set drive letter task panicked: {e}"))?
}
```

- [ ] **Step 3: Register the commands**

In `apps/desktop/src-tauri/src/lib.rs`, add to the `tauri::generate_handler![...]` list, right
after `commands::get_wipe_progress,`:

```rust
            commands::list_disks,
            commands::create_partition,
            commands::delete_partition,
            commands::resize_partition,
            commands::format_partition,
            commands::set_drive_letter,
```

- [ ] **Step 4: Build**

Run: `cargo build --workspace`
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "Add Tauri commands for disk partition management"
```

---

### Task 9: `system.partitions` permission -- types, `pluginApi.ts`, tests

**Files:**
- Modify: `apps/desktop/src/types/plugin.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.test.ts`

- [ ] **Step 1: Add the `DiskInfo`/`PartitionInfo` types**

In `apps/desktop/src/types/plugin.ts`, add after the `WipeProgress` interface:

```ts
export interface PartitionInfo {
  driveLetter: string | null;
  sizeBytes: number;
  offsetBytes: number;
  filesystem: string | null;
  partitionType: string;
}

export interface DiskInfo {
  number: number;
  totalBytes: number;
  isSystem: boolean;
  model: string;
  partitions: PartitionInfo[];
}
```

- [ ] **Step 2: Add the six methods to `PluginApi`**

In the same file, add to the `PluginApi` interface, after the `getWipeProgress` entry:

```ts
  /** Present only if the plugin's manifest declares the "system.partitions" permission. Lists
   * every physical disk and its partitions, including unallocated space (inferred client-side
   * from gaps between partition offsets -- not returned explicitly). Read-only; does not require
   * elevation. */
  listDisks?: () => Promise<DiskInfo[]>;
  /** Present only if the plugin's manifest declares the "system.partitions" permission. Creates
   * a new partition in existing unallocated space on `diskNumber`, formats it with `filesystem`
   * ("NTFS" | "FAT32" | "exFAT"), and optionally assigns `driveLetter` (auto-assigned if
   * omitted). Triggers a Windows UAC elevation prompt. Refuses (rejected promise) if `diskNumber`
   * is the system disk. */
  createPartition?: (
    diskNumber: number,
    offsetBytes: number,
    sizeBytes: number,
    filesystem: string,
    driveLetter?: string,
  ) => Promise<PartitionInfo>;
  /** Present only if the plugin's manifest declares the "system.partitions" permission. Deletes
   * the partition at `driveLetter` on `diskNumber`, returning its space to unallocated. Triggers
   * a Windows UAC elevation prompt. Refuses (rejected promise) if `diskNumber` is the system
   * disk. **Permanently destroys all data on the partition.** */
  deletePartition?: (diskNumber: number, driveLetter: string) => Promise<void>;
  /** Present only if the plugin's manifest declares the "system.partitions" permission. Resizes
   * the partition at `driveLetter` on `diskNumber` to `newSizeBytes` -- shrinking or extending
   * into adjacent unallocated space only (whatever Windows itself reports as the valid range).
   * Triggers a Windows UAC elevation prompt. Refuses (rejected promise) if `diskNumber` is the
   * system disk. **Shrinking can destroy data if the requested size is smaller than the data
   * already on the partition.** */
  resizePartition?: (
    diskNumber: number,
    driveLetter: string,
    newSizeBytes: number,
  ) => Promise<PartitionInfo>;
  /** Present only if the plugin's manifest declares the "system.partitions" permission.
   * Reformats the partition at `driveLetter` in place with `filesystem`. Triggers a Windows UAC
   * elevation prompt. Refuses (rejected promise) if `diskNumber` is the system disk.
   * **Permanently destroys all data on the partition.** */
  formatPartition?: (
    diskNumber: number,
    driveLetter: string,
    filesystem: string,
  ) => Promise<PartitionInfo>;
  /** Present only if the plugin's manifest declares the "system.partitions" permission.
   * Reassigns the drive letter of the partition currently at `currentLetter` on `diskNumber` to
   * `newLetter`, or removes its letter entirely if `newLetter` is omitted. Triggers a Windows UAC
   * elevation prompt. Refuses (rejected promise) if `diskNumber` is the system disk. Does not
   * touch the partition's data. */
  setDriveLetter?: (
    diskNumber: number,
    currentLetter: string,
    newLetter?: string,
  ) => Promise<void>;
```

- [ ] **Step 3: Wire the permission into `pluginApi.ts`**

In `apps/desktop/src/plugins/pluginApi.ts`, add `DiskInfo` and `PartitionInfo` to the type import
from `"../types/plugin"` (alphabetically), add six entries to the `PluginApiHandlers` interface
(after `getWipeProgress`):

```ts
  listDisks: () => Promise<DiskInfo[]>;
  createPartition: (
    diskNumber: number,
    offsetBytes: number,
    sizeBytes: number,
    filesystem: string,
    driveLetter?: string,
  ) => Promise<PartitionInfo>;
  deletePartition: (diskNumber: number, driveLetter: string) => Promise<void>;
  resizePartition: (
    diskNumber: number,
    driveLetter: string,
    newSizeBytes: number,
  ) => Promise<PartitionInfo>;
  formatPartition: (
    diskNumber: number,
    driveLetter: string,
    filesystem: string,
  ) => Promise<PartitionInfo>;
  setDriveLetter: (diskNumber: number, currentLetter: string, newLetter?: string) => Promise<void>;
```

and a new gating block in `createPluginApi`, after the `fs.wipe` block:

```ts
  if (has("system.partitions")) {
    api.listDisks = () => handlers.listDisks();
    api.createPartition = (diskNumber, offsetBytes, sizeBytes, filesystem, driveLetter) =>
      handlers.createPartition(diskNumber, offsetBytes, sizeBytes, filesystem, driveLetter);
    api.deletePartition = (diskNumber, driveLetter) =>
      handlers.deletePartition(diskNumber, driveLetter);
    api.resizePartition = (diskNumber, driveLetter, newSizeBytes) =>
      handlers.resizePartition(diskNumber, driveLetter, newSizeBytes);
    api.formatPartition = (diskNumber, driveLetter, filesystem) =>
      handlers.formatPartition(diskNumber, driveLetter, filesystem);
    api.setDriveLetter = (diskNumber, currentLetter, newLetter) =>
      handlers.setDriveLetter(diskNumber, currentLetter, newLetter);
  }
```

- [ ] **Step 4: Update `pluginApi.test.ts`**

In `apps/desktop/src/plugins/pluginApi.test.ts`:

Add `DiskInfo, PartitionInfo` to the type import from `"../types/plugin"`.

Add to the `handlers()` mock, after `getWipeProgress`:

```ts
    listDisks: vi.fn().mockResolvedValue([] as DiskInfo[]),
    createPartition: vi.fn().mockResolvedValue({
      driveLetter: "E:",
      sizeBytes: 500_000_000_000,
      offsetBytes: 1_048_576,
      filesystem: "NTFS",
      partitionType: "Basic",
    } satisfies PartitionInfo),
    deletePartition: vi.fn().mockResolvedValue(undefined),
    resizePartition: vi.fn().mockResolvedValue({
      driveLetter: "E:",
      sizeBytes: 600_000_000_000,
      offsetBytes: 1_048_576,
      filesystem: "NTFS",
      partitionType: "Basic",
    } satisfies PartitionInfo),
    formatPartition: vi.fn().mockResolvedValue({
      driveLetter: "E:",
      sizeBytes: 500_000_000_000,
      offsetBytes: 1_048_576,
      filesystem: "exFAT",
      partitionType: "Basic",
    } satisfies PartitionInfo),
    setDriveLetter: vi.fn().mockResolvedValue(undefined),
```

Add `"system.partitions"` to `ALL_PERMISSIONS`, and `"listDisks", "createPartition",
"deletePartition", "resizePartition", "formatPartition", "setDriveLetter"` to `ALL_METHODS`.

Add a row to the `it.each` permission table:

```ts
    ["system.partitions", ["listDisks", "createPartition", "deletePartition", "resizePartition", "formatPartition", "setDriveLetter"]],
```

Add dedicated forwarding tests, after the existing `getWipeProgress` test:

```ts
  it("listDisks calls the handler with no arguments", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["system.partitions"]), h);

    await api.listDisks?.();

    expect(h.listDisks).toHaveBeenCalledWith();
  });

  it("createPartition forwards all arguments to the handler", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["system.partitions"]), h);

    await api.createPartition?.(1, 1_048_576, 500_000_000_000, "NTFS", "E:");

    expect(h.createPartition).toHaveBeenCalledWith(1, 1_048_576, 500_000_000_000, "NTFS", "E:");
  });

  it("deletePartition calls the handler with the disk number and drive letter", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["system.partitions"]), h);

    await api.deletePartition?.(1, "E:");

    expect(h.deletePartition).toHaveBeenCalledWith(1, "E:");
  });

  it("resizePartition forwards all arguments to the handler", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["system.partitions"]), h);

    await api.resizePartition?.(1, "E:", 600_000_000_000);

    expect(h.resizePartition).toHaveBeenCalledWith(1, "E:", 600_000_000_000);
  });

  it("formatPartition forwards all arguments to the handler", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["system.partitions"]), h);

    await api.formatPartition?.(1, "E:", "exFAT");

    expect(h.formatPartition).toHaveBeenCalledWith(1, "E:", "exFAT");
  });

  it("setDriveLetter forwards all arguments to the handler", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["system.partitions"]), h);

    await api.setDriveLetter?.(1, "E:", "G:");

    expect(h.setDriveLetter).toHaveBeenCalledWith(1, "E:", "G:");
  });
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- pluginApi.test.ts` (from `apps/desktop/`)
Expected: all tests pass (54 total: 48 from before plus 6 new dedicated forwarding tests, with the
two blanket "grants every method"/"grants no methods" tests and the `it.each` table also covering
the six new methods without adding their own separate count).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/types/plugin.ts apps/desktop/src/plugins/pluginApi.ts apps/desktop/src/plugins/pluginApi.test.ts
git commit -m "Add the system.partitions plugin permission"
```

---

### Task 10: Wire `usePluginStore.ts`

**Files:**
- Modify: `apps/desktop/src/stores/usePluginStore.ts`

- [ ] **Step 1: Add the type import**

Add `DiskInfo, PartitionInfo` to the type import from `"../types/plugin"`.

- [ ] **Step 2: Add the six real handlers**

In the `createPluginApi(manifest, { ... })` call, add after `getWipeProgress`:

```ts
          listDisks: () => invoke<DiskInfo[]>("list_disks"),
          createPartition: (diskNumber, offsetBytes, sizeBytes, filesystem, driveLetter) =>
            invoke<PartitionInfo>("create_partition", {
              diskNumber,
              offsetBytes,
              sizeBytes,
              filesystem,
              driveLetter,
            }),
          deletePartition: (diskNumber, driveLetter) =>
            invoke<void>("delete_partition", { diskNumber, driveLetter }),
          resizePartition: (diskNumber, driveLetter, newSizeBytes) =>
            invoke<PartitionInfo>("resize_partition", { diskNumber, driveLetter, newSizeBytes }),
          formatPartition: (diskNumber, driveLetter, filesystem) =>
            invoke<PartitionInfo>("format_partition", { diskNumber, driveLetter, filesystem }),
          setDriveLetter: (diskNumber, currentLetter, newLetter) =>
            invoke<void>("set_drive_letter", { diskNumber, currentLetter, newLetter }),
```

- [ ] **Step 3: Build the frontend**

Run: `npm run build` (from `apps/desktop/`)
Expected: builds successfully (TypeScript compiles cleanly).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/stores/usePluginStore.ts
git commit -m "Wire system.partitions methods into usePluginStore"
```

---

### Task 11: Example plugin — `examples/plugins/disk-partition-manager/`

**Files:**
- Create: `examples/plugins/disk-partition-manager/manifest.json`
- Create: `examples/plugins/disk-partition-manager/frontend/index.js`
- Create: `examples/plugins/disk-partition-manager/README.md`

- [ ] **Step 1: Write `manifest.json`**

```json
{
  "id": "disk-partition-manager",
  "name": "Disk Partition Manager",
  "version": "1.0.0",
  "author": "Krampus Explorer",
  "permissions": ["ui.sidebar", "ui.confirm", "system.partitions"],
  "entry": "frontend/index.js"
}
```

- [ ] **Step 2: Write `frontend/index.js`**

This renders the proportional disk map, an action panel for the selected partition/unallocated
segment, and the typed-confirmation gate for Delete/Resize/Format (Change Letter and New
Partition use `api.confirm()` instead, since neither can destroy existing data).

```js
// Entry point for the "Disk Partition Manager" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", confirm: "ui.confirm", listDisks/createPartition/
// deletePartition/resizePartition/formatPartition/setDriveLetter: "system.partitions").
//
// The backend independently refuses every mutating call against the system disk -- this
// frontend's own disabling of those buttons is a second, non-authoritative layer, the same
// two-independent-checks pattern Drive Format and Secure Wipe both use.

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Computes the gaps between partitions (and after the last one) as pseudo-segments so the map
// can render unallocated space -- the backend doesn't return these explicitly (see the plugin
// design doc), since "gap between known offsets" is trivial to derive client-side.
function withUnallocatedGaps(disk) {
  const sorted = [...disk.partitions].sort((a, b) => a.offsetBytes - b.offsetBytes);
  const segments = [];
  let cursor = 0;
  for (const partition of sorted) {
    if (partition.offsetBytes > cursor) {
      segments.push({ kind: "unallocated", offsetBytes: cursor, sizeBytes: partition.offsetBytes - cursor });
    }
    segments.push({ kind: "partition", ...partition });
    cursor = partition.offsetBytes + partition.sizeBytes;
  }
  if (cursor < disk.totalBytes) {
    segments.push({ kind: "unallocated", offsetBytes: cursor, sizeBytes: disk.totalBytes - cursor });
  }
  return segments;
}

api.registerSidebarPanel({
  id: "disk-partition-manager",
  title: "Disk Partition Manager",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "10px";
    container.style.fontSize = "12px";

    const mapContainer = document.createElement("div");
    mapContainer.style.display = "flex";
    mapContainer.style.flexDirection = "column";
    mapContainer.style.gap = "10px";

    const actionPanel = document.createElement("div");
    actionPanel.style.borderTop = "1px solid var(--border, #444)";
    actionPanel.style.paddingTop = "8px";
    actionPanel.style.display = "none";
    actionPanel.style.flexDirection = "column";
    actionPanel.style.gap = "6px";

    const status = document.createElement("p");
    status.style.margin = "0";
    status.style.color = "var(--fg-muted)";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    let disks = [];

    async function refresh() {
      try {
        disks = await api.listDisks();
        renderMap();
      } catch (error) {
        setStatus(String(error), true);
      }
    }

    function renderMap() {
      mapContainer.innerHTML = "";
      for (const disk of disks) {
        const label = document.createElement("div");
        label.style.fontWeight = "600";
        label.textContent = `Disk ${disk.number}${disk.isSystem ? " (System)" : ""} — ${disk.model} (${formatSize(disk.totalBytes)})`;
        mapContainer.appendChild(label);

        const bar = document.createElement("div");
        bar.style.display = "flex";
        bar.style.height = "40px";
        bar.style.borderRadius = "4px";
        bar.style.overflow = "hidden";
        bar.style.border = "1px solid var(--border, #444)";

        for (const segment of withUnallocatedGaps(disk)) {
          const cell = document.createElement("div");
          cell.style.flex = `0 0 ${Math.max(2, (segment.sizeBytes / disk.totalBytes) * 100)}%`;
          cell.style.display = "flex";
          cell.style.alignItems = "center";
          cell.style.justifyContent = "center";
          cell.style.fontSize = "10px";
          cell.style.color = "#fff";
          cell.style.cursor = "pointer";
          cell.style.borderRight = "1px solid var(--border, #333)";
          cell.title = `${formatSize(segment.sizeBytes)}`;

          if (segment.kind === "unallocated") {
            cell.style.background = "#2a2f36";
            cell.textContent = "Unallocated";
            cell.addEventListener("click", () => showNewPartitionPanel(disk, segment));
          } else {
            cell.style.background = disk.isSystem ? "#5b6472" : "#3b5f8a";
            cell.textContent = segment.driveLetter ?? "(no letter)";
            cell.addEventListener("click", () => showPartitionPanel(disk, segment));
          }

          bar.appendChild(cell);
        }

        mapContainer.appendChild(bar);
      }
    }

    function clearActionPanel() {
      actionPanel.style.display = "none";
      actionPanel.innerHTML = "";
    }

    function showPartitionPanel(disk, partition) {
      actionPanel.innerHTML = "";
      actionPanel.style.display = "flex";

      const heading = document.createElement("div");
      heading.style.fontWeight = "600";
      heading.textContent = `${partition.driveLetter ?? "(no letter)"} — ${formatSize(partition.sizeBytes)} — ${partition.filesystem ?? "unknown filesystem"}`;
      actionPanel.appendChild(heading);

      if (disk.isSystem) {
        const note = document.createElement("p");
        note.style.margin = "0";
        note.style.color = "var(--fg-muted)";
        note.textContent = "Not available on the system disk.";
        actionPanel.appendChild(note);
        return;
      }

      actionPanel.appendChild(
        buildTypedConfirmAction({
          label: "Delete Partition",
          confirmText: partition.driveLetter ?? "DELETE",
          run: () => api.deletePartition(disk.number, partition.driveLetter),
          successMessage: "Partition deleted.",
        }),
      );

      actionPanel.appendChild(
        buildTypedConfirmAction({
          label: "Format",
          confirmText: partition.driveLetter ?? "DELETE",
          run: () => api.formatPartition(disk.number, partition.driveLetter, "NTFS"),
          successMessage: "Partition formatted.",
        }),
      );

      const letterBtn = document.createElement("button");
      letterBtn.textContent = "Change Drive Letter…";
      letterBtn.addEventListener("click", async () => {
        const ok = await api.confirm(`Change the drive letter for ${partition.driveLetter}?`);
        if (!ok) return;
        const newLetter = window.prompt("New drive letter (leave blank to remove):", "");
        try {
          await api.setDriveLetter(disk.number, partition.driveLetter, newLetter ? `${newLetter}:` : undefined);
          setStatus("Drive letter updated.", false);
          await refresh();
        } catch (error) {
          setStatus(String(error), true);
        }
      });
      actionPanel.appendChild(letterBtn);
    }

    function showNewPartitionPanel(disk, gap) {
      actionPanel.innerHTML = "";
      actionPanel.style.display = "flex";

      const heading = document.createElement("div");
      heading.style.fontWeight = "600";
      heading.textContent = `Unallocated — ${formatSize(gap.sizeBytes)}`;
      actionPanel.appendChild(heading);

      if (disk.isSystem) {
        const note = document.createElement("p");
        note.style.margin = "0";
        note.style.color = "var(--fg-muted)";
        note.textContent = "Not available on the system disk.";
        actionPanel.appendChild(note);
        return;
      }

      const newBtn = document.createElement("button");
      newBtn.textContent = "New Partition…";
      newBtn.addEventListener("click", async () => {
        const ok = await api.confirm(`Create a new NTFS partition using all ${formatSize(gap.sizeBytes)} of unallocated space?`);
        if (!ok) return;
        try {
          await api.createPartition(disk.number, gap.offsetBytes, gap.sizeBytes, "NTFS");
          setStatus("Partition created.", false);
          clearActionPanel();
          await refresh();
        } catch (error) {
          setStatus(String(error), true);
        }
      });
      actionPanel.appendChild(newBtn);
    }

    function buildTypedConfirmAction({ label, confirmText, run, successMessage }) {
      const wrapper = document.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.flexDirection = "column";
      wrapper.style.gap = "4px";

      const hint = document.createElement("span");
      hint.style.fontSize = "11px";
      hint.style.color = "var(--fg-muted)";
      hint.textContent = `Type "${confirmText}" to enable`;

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = confirmText;

      const btn = document.createElement("button");
      btn.textContent = label;
      btn.disabled = true;

      input.addEventListener("input", () => {
        btn.disabled = input.value.trim().toUpperCase() !== confirmText.toUpperCase();
      });

      btn.addEventListener("click", async () => {
        btn.disabled = true;
        input.disabled = true;
        setStatus("Working… (approve the Administrator prompt if one appears)", false);
        try {
          await run();
          setStatus(successMessage, false);
          clearActionPanel();
          await refresh();
        } catch (error) {
          setStatus(String(error), true);
          input.disabled = false;
        }
      });

      wrapper.appendChild(hint);
      wrapper.appendChild(input);
      wrapper.appendChild(btn);
      return wrapper;
    }

    container.appendChild(mapContainer);
    container.appendChild(actionPanel);
    container.appendChild(status);

    void refresh();
  },
});
```

- [ ] **Step 3: Write `README.md`**

```markdown
# Disk Partition Manager

Sidebar panel showing a proportional visual map of every physical disk and its partitions (like
Windows' own Disk Management), with the ability to create, delete, resize, format, and relabel
partitions.

**The entire physical disk holding Windows is read-only** — every destructive action is disabled
for all of its partitions, including EFI/Recovery partitions, not just the Windows partition
itself. The backend independently refuses every mutating call against that disk too, re-checked
fresh on every call rather than trusting this frontend's own button-disabling.

Delete, Resize, and Format each require typing the partition's drive letter (or "DELETE" if it
has none) before the action enables — the same friction level the Secure Wipe plugin uses, since
there's no native OS dialog acting as a second safety gate. Creating a partition or changing a
drive letter uses a normal Confirm/Cancel dialog instead, since neither can destroy existing data.

Every mutating action (New Partition, Delete, Resize, Format, Change Letter) triggers a separate
Windows UAC elevation prompt — partition-table operations require Administrator, and each action
elevates independently rather than sharing one elevated session.

## Permissions

- `ui.sidebar` — registers the panel.
- `ui.confirm` — the Confirm/Cancel dialog for New Partition and Change Drive Letter.
- `system.partitions` — lists disks and performs all five partition operations.
```

- [ ] **Step 4: Manually verify the app loads the plugin**

Run: `cd apps/desktop && npm run tauri dev` (or copy the plugin into
`%APPDATA%\Krampus Explorer\plugins\` and restart the packaged app), confirm the panel appears in
the sidebar and `listDisks()` renders a disk map without errors. **Do not exercise any destructive
action against the system disk's partitions.** If a spare secondary physical disk or its USB stick
is available, verifying the system-disk exclusion (no button becomes clickable anywhere on that
disk) is the single most important manual check for this plugin.

- [ ] **Step 5: Commit**

```bash
git add examples/plugins/disk-partition-manager
git commit -m "Add the Disk Partition Manager example plugin"
```

---

### Task 12: Documentation and marketplace listing

**Files:**
- Modify: `docs/plugins.md`
- Modify: `marketplace.json`

- [ ] **Step 1: Add to the example-plugins list**

In `docs/plugins.md`, add after the `secure-wipe` bullet:

```markdown
- `examples/plugins/disk-partition-manager/` — visual disk/partition map with create/delete/
  resize/format/relabel via `system.partitions`
```

- [ ] **Step 2: Add to the permissions table**

Add a row after the `fs.wipe` row:

```markdown
| `system.partitions` | `api.listDisks()`, `api.createPartition(diskNumber, offsetBytes, sizeBytes, filesystem, driveLetter?)`, `api.deletePartition(diskNumber, driveLetter)`, `api.resizePartition(diskNumber, driveLetter, newSizeBytes)`, `api.formatPartition(diskNumber, driveLetter, filesystem)`, `api.setDriveLetter(diskNumber, currentLetter, newLetter?)` |
```

- [ ] **Step 3: Add a `### system.partitions methods` section**

Add after the `### fs.wipe methods` section (before `## Plugin marketplace`):

```markdown
### `system.partitions` methods

- `listDisks(): Promise<DiskInfo[]>` — every physical disk and its partitions. `DiskInfo` has
  `number`, `totalBytes`, `isSystem`, `model`, and `partitions: PartitionInfo[]`. `PartitionInfo`
  has `driveLetter` (nullable), `sizeBytes`, `offsetBytes`, `filesystem` (nullable), and
  `partitionType`. Unallocated space isn't returned explicitly -- compute gaps between partition
  offsets client-side, as the reference plugin does. Read-only; does not require elevation.
- `createPartition(diskNumber, offsetBytes, sizeBytes, filesystem, driveLetter?):
  Promise<PartitionInfo>` — creates and formats a new partition in existing unallocated space.
  Triggers a UAC prompt. Refuses (rejected promise) if `diskNumber` is the system disk.
- `deletePartition(diskNumber, driveLetter): Promise<void>` — **permanently destroys all data on
  the partition.** Triggers a UAC prompt. Refuses if `diskNumber` is the system disk.
- `resizePartition(diskNumber, driveLetter, newSizeBytes): Promise<PartitionInfo>` — shrinks or
  extends into adjacent unallocated space only. Triggers a UAC prompt. Refuses if `diskNumber` is
  the system disk. **Shrinking below the partition's used space can destroy data.**
- `formatPartition(diskNumber, driveLetter, filesystem): Promise<PartitionInfo>` — reformats in
  place. Triggers a UAC prompt. Refuses if `diskNumber` is the system disk. **Permanently destroys
  all data on the partition.**
- `setDriveLetter(diskNumber, currentLetter, newLetter?): Promise<void>` — reassigns or removes a
  partition's drive letter. Triggers a UAC prompt. Refuses if `diskNumber` is the system disk.
  Does not touch data.

Every mutating method elevates `powershell.exe` per-call (a separate UAC prompt each time) rather
than sharing one elevated session, and every one of them independently re-checks `diskNumber`
against the current system disk on the backend -- never trust a cached `isSystem` flag from an
earlier `listDisks()` call as the reason a destructive action is safe to offer. See
`examples/plugins/disk-partition-manager/` for the reference implementation, including the typed-
confirmation flow used before calling `deletePartition`/`resizePartition`/`formatPartition`.
```

- [ ] **Step 4: Add to `marketplace.json`**

Add after the `secure-wipe` entry (before the closing `]`):

```json
  {
    "id": "disk-partition-manager",
    "name": "Disk Partition Manager",
    "description": "Visual disk map: create, delete, resize, format, and relabel partitions. Permanently erases data on affected partitions."
  }
```

- [ ] **Step 5: Commit**

```bash
git add docs/plugins.md marketplace.json
git commit -m "Document the system.partitions permission and Disk Partition Manager plugin"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run the full Rust test suite**

Run: `cargo test --workspace`
Expected: all tests pass, including the 17 new `explorer-partitions` tests.

- [ ] **Step 2: Run clippy across the whole workspace**

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 3: Run `cargo fmt` and check for diffs**

Run: `cargo fmt --all -- --check`
Expected: no diffs. If there are any, run `cargo fmt --all` and commit the reflow separately
(matching this session's established pattern of a dedicated "Run cargo fmt" commit at the end of
each plugin).

- [ ] **Step 4: Run the full frontend test suite**

Run: `npm test` (from `apps/desktop/`)
Expected: all tests pass, including the 6 new `system.partitions` tests in `pluginApi.test.ts`.

- [ ] **Step 5: Run the frontend build**

Run: `npm run build` (from `apps/desktop/`)
Expected: builds successfully, no TypeScript errors.

- [ ] **Step 6: Final commit if `cargo fmt` produced changes**

```bash
git add -A
git commit -m "Run cargo fmt"
```
