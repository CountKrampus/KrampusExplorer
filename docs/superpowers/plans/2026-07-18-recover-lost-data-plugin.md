# Recover Lost Data Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Recover Lost Data plugin that scans a raw drive for recognizable file signatures
(JPEG, PNG, PDF, ZIP, MP3) and extracts matches to a destination folder, requiring Administrator
elevation for the raw disk read.

**Architecture:** A new `crates/recovery` crate splits pure, unit-testable logic (signature
detection, extraction-length capping, progress-file serialization) from the untestable-without-
real-hardware parts (the actual raw volume read, the UAC elevation relaunch). The elevated scan
runs headless — a second OS process with no window — writing progress to a JSON file that the
main app polls via a Tauri command. All category-specific UI logic lives in the plugin's own JS,
as with every prior plugin.

**Tech Stack:** Rust (`windows-sys`, `serde`/`serde_json`), React, TypeScript.

Full design: `docs/superpowers/specs/2026-07-18-recover-lost-data-plugin-design.md`.

---

### Task 1: `crates/recovery` — signature detection (pure, tested)

**Files:**
- Create: `crates/recovery/Cargo.toml`
- Create: `crates/recovery/src/signatures.rs`
- Create: `crates/recovery/src/lib.rs`
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
    "apps/desktop/src-tauri",
]
```

- [ ] **Step 2: Create the crate manifest**

Create `crates/recovery/Cargo.toml`:

```toml
[package]
name = "explorer-recovery"
version.workspace = true
edition.workspace = true
license.workspace = true

[lib]
name = "explorer_recovery"
path = "src/lib.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
explorer-filesystem = { path = "../filesystem" }

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.61", features = [
    "Win32_Storage_FileSystem",
    "Win32_Foundation",
    "Win32_UI_Shell",
] }

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Write the failing tests**

Create `crates/recovery/src/signatures.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FileType {
    Jpeg,
    Png,
    Pdf,
    Zip,
    Mp3,
}

pub const ALL_TYPES: [FileType; 5] =
    [FileType::Jpeg, FileType::Png, FileType::Pdf, FileType::Zip, FileType::Mp3];

/// The longest start marker across every supported type (PNG's 8-byte magic) -- callers scanning
/// consecutive chunks carry over this many bytes minus one from one chunk into the next so a
/// signature straddling the boundary is still detected, exactly once.
pub const MAX_START_MARKER_LEN: usize = 8;

impl FileType {
    /// Parses one of the plugin-facing type identifiers ("jpeg", "png", "pdf", "zip", "mp3").
    pub fn parse(name: &str) -> Result<Self, String> {
        match name {
            "jpeg" => Ok(FileType::Jpeg),
            "png" => Ok(FileType::Png),
            "pdf" => Ok(FileType::Pdf),
            "zip" => Ok(FileType::Zip),
            "mp3" => Ok(FileType::Mp3),
            other => Err(format!("Unknown file type '{other}'")),
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            FileType::Jpeg => "jpg",
            FileType::Png => "png",
            FileType::Pdf => "pdf",
            FileType::Zip => "zip",
            FileType::Mp3 => "mp3",
        }
    }

    /// Destination subfolder name -- also used as the key in `RecoveryProgress`'s
    /// `files_found_by_type` map, so the two stay in sync automatically.
    pub fn subfolder(&self) -> &'static str {
        self.extension_family()
    }

    fn extension_family(&self) -> &'static str {
        match self {
            FileType::Jpeg => "jpeg",
            FileType::Png => "png",
            FileType::Pdf => "pdf",
            FileType::Zip => "zip",
            FileType::Mp3 => "mp3",
        }
    }

    /// Max bytes to extract for a single recovered file of this type. Caps runaway extraction
    /// when an end marker is missing (ZIP, MP3 -- neither has one this carving approach can rely
    /// on) or wasn't found within a sane size (JPEG, PNG, PDF -- e.g. because the true end was
    /// already overwritten by something else).
    pub fn max_size(&self) -> usize {
        match self {
            FileType::Jpeg => 20 * 1024 * 1024,
            FileType::Png => 20 * 1024 * 1024,
            FileType::Pdf => 50 * 1024 * 1024,
            FileType::Zip => 100 * 1024 * 1024,
            FileType::Mp3 => 20 * 1024 * 1024,
        }
    }

    fn start_marker(&self) -> &'static [u8] {
        match self {
            FileType::Jpeg => &[0xFF, 0xD8, 0xFF],
            FileType::Png => &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
            FileType::Pdf => b"%PDF",
            FileType::Zip => &[0x50, 0x4B, 0x03, 0x04],
            FileType::Mp3 => b"ID3",
        }
    }

    fn end_marker(&self) -> Option<&'static [u8]> {
        match self {
            FileType::Jpeg => Some(&[0xFF, 0xD9]),
            FileType::Png => Some(&[0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]), // "IEND" + its fixed CRC
            FileType::Pdf => Some(b"%%EOF"),
            FileType::Zip | FileType::Mp3 => None,
        }
    }
}

/// Finds the earliest occurrence of any `enabled_types`' start marker in `data`, only considering
/// match positions >= `min_search_start`. Callers scanning consecutive chunks with a carried-over
/// prefix pass `carry_len.saturating_sub(MAX_START_MARKER_LEN - 1)` here, so a marker fully
/// contained within the carry (already found while scanning the previous chunk) isn't reported a
/// second time, while one straddling the boundary still is.
pub fn find_earliest_start(
    data: &[u8],
    min_search_start: usize,
    enabled_types: &[FileType],
) -> Option<(usize, FileType)> {
    let mut earliest: Option<(usize, FileType)> = None;
    for &file_type in enabled_types {
        let marker = file_type.start_marker();
        if marker.len() > data.len() {
            continue;
        }
        let mut pos = min_search_start;
        while pos + marker.len() <= data.len() {
            if &data[pos..pos + marker.len()] == marker {
                if earliest.map_or(true, |(earliest_pos, _)| pos < earliest_pos) {
                    earliest = Some((pos, file_type));
                }
                break;
            }
            pos += 1;
        }
    }
    earliest
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    (0..=haystack.len() - needle.len()).find(|&i| &haystack[i..i + needle.len()] == needle)
}

/// Given `data` starting at a detected start marker for `file_type`, returns how many bytes to
/// extract: up to and including the end marker if `file_type` has one and it's found within the
/// type's cap, otherwise exactly the cap (or `data.len()` if shorter) -- extraction is always
/// bounded, never open-ended.
pub fn find_extraction_length(data: &[u8], file_type: FileType) -> usize {
    let cap = file_type.max_size().min(data.len());
    if let Some(marker) = file_type.end_marker() {
        if let Some(found_at) = find_subslice(&data[..cap], marker) {
            return (found_at + marker.len()).min(cap);
        }
    }
    cap
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_jpeg_start_marker() {
        let data = [0x00, 0x00, 0xFF, 0xD8, 0xFF, 0x00];
        let result = find_earliest_start(&data, 0, &ALL_TYPES);
        assert_eq!(result, Some((2, FileType::Jpeg)));
    }

    #[test]
    fn finds_the_earliest_of_multiple_markers() {
        let mut data = vec![0u8; 20];
        data[10..13].copy_from_slice(&[0xFF, 0xD8, 0xFF]); // JPEG at 10
        data[2..6].copy_from_slice(b"%PDF"); // PDF at 2, earlier
        let result = find_earliest_start(&data, 0, &ALL_TYPES);
        assert_eq!(result, Some((2, FileType::Pdf)));
    }

    #[test]
    fn returns_none_when_no_marker_present() {
        let data = [0u8; 32];
        assert_eq!(find_earliest_start(&data, 0, &ALL_TYPES), None);
    }

    #[test]
    fn respects_min_search_start_to_avoid_rereporting_the_carry_region() {
        // A JPEG marker at position 1, but min_search_start = 3 means it's in the already-
        // scanned carry region and must not be reported again.
        let data = [0x00, 0xFF, 0xD8, 0xFF, 0x00];
        assert_eq!(find_earliest_start(&data, 3, &ALL_TYPES), None);
    }

    #[test]
    fn still_finds_a_marker_that_starts_exactly_at_min_search_start() {
        let data = [0x00, 0x00, 0x00, 0xFF, 0xD8, 0xFF];
        assert_eq!(find_earliest_start(&data, 3, &ALL_TYPES), Some((3, FileType::Jpeg)));
    }

    #[test]
    fn only_considers_enabled_types() {
        let data = [0xFF, 0xD8, 0xFF];
        assert_eq!(find_earliest_start(&data, 0, &[FileType::Png]), None);
        assert_eq!(find_earliest_start(&data, 0, &[FileType::Jpeg]), Some((0, FileType::Jpeg)));
    }

    #[test]
    fn jpeg_extraction_stops_at_the_end_marker() {
        let data = [0xFF, 0xD8, 0xFF, 0x00, 0x00, 0xFF, 0xD9, 0x00, 0x00];
        assert_eq!(find_extraction_length(&data, FileType::Jpeg), 7);
    }

    #[test]
    fn pdf_extraction_stops_after_percent_percent_eof() {
        let mut data = b"%PDF-1.4 some content ".to_vec();
        data.extend_from_slice(b"%%EOF");
        data.extend_from_slice(b" trailing garbage that should not be included");
        let expected_len = b"%PDF-1.4 some content %%EOF".len();
        assert_eq!(find_extraction_length(&data, FileType::Pdf), expected_len);
    }

    #[test]
    fn zip_has_no_end_marker_and_is_capped_at_max_size() {
        let data = vec![0u8; 200];
        assert_eq!(find_extraction_length(&data, FileType::Zip), 200);
    }

    #[test]
    fn extraction_is_capped_even_when_no_end_marker_is_found_within_the_cap() {
        // A JPEG with no FFD9 anywhere: extraction still stops at data.len() rather than
        // running forever.
        let data = vec![0u8; 50];
        assert_eq!(find_extraction_length(&data, FileType::Jpeg), 50);
    }
}
```

- [ ] **Step 4: Create a minimal `lib.rs` so the tests compile**

Create `crates/recovery/src/lib.rs`:

```rust
mod signatures;

pub use signatures::{find_earliest_start, find_extraction_length, FileType, ALL_TYPES, MAX_START_MARKER_LEN};
```

- [ ] **Step 5: Run the tests**

Run: `cargo test -p explorer-recovery signatures`
Expected: PASS, 10 tests. (Written alongside the implementation rather than strictly
red-then-green, since the pure signature-matching logic is simple enough to get right directly —
but every assertion above is a real, meaningful check, not a placeholder.)

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml crates/recovery/Cargo.toml crates/recovery/src/signatures.rs crates/recovery/src/lib.rs
git commit -m "Add explorer-recovery crate with pure signature-detection logic"
```

---

### Task 2: `crates/recovery` — progress file (pure I/O, tested)

**Files:**
- Create: `crates/recovery/src/progress.rs`
- Modify: `crates/recovery/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/recovery/src/progress.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecoveryStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryProgress {
    pub status: RecoveryStatus,
    pub bytes_scanned: u64,
    pub total_bytes: u64,
    pub files_found_by_type: HashMap<String, u32>,
    pub error: Option<String>,
}

pub fn write_progress(path: &Path, progress: &RecoveryProgress) -> Result<(), String> {
    let json =
        serde_json::to_string(progress).map_err(|e| format!("Could not serialize progress: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("Could not write progress file: {e}"))
}

pub fn read_progress(path: &Path) -> Result<RecoveryProgress, String> {
    let json = std::fs::read_to_string(path)
        .map_err(|e| format!("Could not read progress file: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("Could not parse progress file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as StdHashMap;

    #[test]
    fn round_trips_a_running_progress_through_a_real_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let mut files_found = StdHashMap::new();
        files_found.insert("jpeg".to_string(), 3u32);

        let original = RecoveryProgress {
            status: RecoveryStatus::Running,
            bytes_scanned: 1024,
            total_bytes: 2048,
            files_found_by_type: files_found,
            error: None,
        };

        write_progress(&path, &original).unwrap();
        let loaded = read_progress(&path).unwrap();

        assert_eq!(loaded, original);
    }

    #[test]
    fn round_trips_a_completed_progress() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let original = RecoveryProgress {
            status: RecoveryStatus::Completed,
            bytes_scanned: 2048,
            total_bytes: 2048,
            files_found_by_type: StdHashMap::new(),
            error: None,
        };

        write_progress(&path, &original).unwrap();
        assert_eq!(read_progress(&path).unwrap(), original);
    }

    #[test]
    fn round_trips_a_failed_progress_with_an_error_message() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let original = RecoveryProgress {
            status: RecoveryStatus::Failed,
            bytes_scanned: 512,
            total_bytes: 2048,
            files_found_by_type: StdHashMap::new(),
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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p explorer-recovery progress`
Expected: FAIL — `crates/recovery/src/progress.rs` isn't wired into `lib.rs` yet, so `mod progress`
doesn't exist.

- [ ] **Step 3: Wire it into `lib.rs`**

In `crates/recovery/src/lib.rs`, change:

```rust
mod signatures;

pub use signatures::{find_earliest_start, find_extraction_length, FileType, ALL_TYPES, MAX_START_MARKER_LEN};
```

to:

```rust
mod progress;
mod signatures;

pub use progress::{read_progress, RecoveryProgress, RecoveryStatus};
pub use signatures::{find_earliest_start, find_extraction_length, FileType, ALL_TYPES, MAX_START_MARKER_LEN};
```

(`write_progress` stays private to the crate for now -- it's only called from `scan.rs` in Task 3,
in the same crate, so it doesn't need to be part of the public API surface yet.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p explorer-recovery progress`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/recovery/src/progress.rs crates/recovery/src/lib.rs
git commit -m "Add recovery progress-file read/write"
```

---

### Task 3: `crates/recovery` — the real raw-disk scan (untested, real I/O)

**Files:**
- Create: `crates/recovery/src/scan.rs`
- Modify: `crates/recovery/src/lib.rs`
- Modify: `crates/recovery/src/progress.rs` (make `write_progress` `pub(crate)`)

This task has **no automated tests** — it opens a real raw disk handle and requires real
Administrator elevation to succeed at all, matching the established precedent for code that
necessarily touches privileged, real OS state (`delete_entry`, the Recycling Bin plugin's trash
functions, Clear Unnecessary Files' `delete_entries`). Verified by hand in Task 8.

- [ ] **Step 1: Make `write_progress` crate-visible**

In `crates/recovery/src/progress.rs`, change:

```rust
pub fn write_progress(path: &Path, progress: &RecoveryProgress) -> Result<(), String> {
```

to:

```rust
pub(crate) fn write_progress(path: &Path, progress: &RecoveryProgress) -> Result<(), String> {
```

- [ ] **Step 2: Write `scan.rs`**

Create `crates/recovery/src/scan.rs`:

```rust
use crate::progress::{write_progress, RecoveryProgress, RecoveryStatus};
use crate::signatures::{find_earliest_start, find_extraction_length, FileType, MAX_START_MARKER_LEN};
use std::collections::HashMap;
use std::path::Path;

/// Runs a full recovery scan: resolves `drive`'s total size, scans it for the given file types,
/// extracting matches into `destination`, and writes progress to `result_file_path` throughout
/// (see `progress.rs`). This is the entry point called from the headless elevated process (see
/// `apps/desktop/src-tauri/src/main.rs`'s `--recovery-scan` dispatch) -- there is no window, no
/// Tauri, and no other way for the caller to observe what's happening except by polling that
/// file.
pub fn run_scan(
    drive: &str,
    destination: &str,
    file_types: &[String],
    result_file_path: &str,
) -> Result<(), String> {
    let result_path = Path::new(result_file_path);
    let enabled_types: Vec<FileType> =
        file_types.iter().map(|s| FileType::parse(s)).collect::<Result<_, _>>()?;
    let total_bytes = total_bytes_for_drive(drive)?;

    let mut progress = RecoveryProgress {
        status: RecoveryStatus::Running,
        bytes_scanned: 0,
        total_bytes,
        files_found_by_type: HashMap::new(),
        error: None,
    };
    write_progress(result_path, &progress)?;

    match scan_volume(drive, destination, &enabled_types, total_bytes, result_path, &mut progress) {
        Ok(()) => {
            progress.status = RecoveryStatus::Completed;
            write_progress(result_path, &progress)?;
            Ok(())
        }
        Err(e) => {
            progress.status = RecoveryStatus::Failed;
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

fn write_extracted_file(
    destination: &str,
    file_type: FileType,
    data: &[u8],
    progress: &mut RecoveryProgress,
) -> Result<(), String> {
    let subfolder = file_type.subfolder();
    let dir = Path::new(destination).join(subfolder);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create '{}': {e}", dir.display()))?;

    let count = progress.files_found_by_type.entry(subfolder.to_string()).or_insert(0);
    *count += 1;
    let filename = format!("recovered_{:04}.{}", count, file_type.extension());
    let file_path = dir.join(filename);
    std::fs::write(&file_path, data).map_err(|e| format!("Could not write '{}': {e}", file_path.display()))
}

#[cfg(windows)]
fn scan_volume(
    drive: &str,
    destination: &str,
    enabled_types: &[FileType],
    total_bytes: u64,
    result_path: &Path,
    progress: &mut RecoveryProgress,
) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, ReadFile, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
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
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(format!(
            "Could not open '{raw_path}' for raw read -- this must run elevated (Administrator)"
        ));
    }

    // 128 MiB: comfortably larger than the biggest per-type extraction cap (ZIP's 100 MiB), so
    // every possible extraction is always fully contained within a single chunk already held in
    // memory -- no extra reads are needed mid-extraction. The tradeoff: a file whose true end
    // lies beyond the current chunk is truncated there rather than followed into the next chunk.
    const CHUNK_SIZE: usize = 128 * 1024 * 1024;
    let mut carry: Vec<u8> = Vec::new();
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut bytes_scanned: u64 = 0;

    let result = (|| -> Result<(), String> {
        loop {
            let mut bytes_read: u32 = 0;
            // SAFETY: `handle` is a valid open handle from the successful CreateFileW call
            // above; `buffer` is valid and sized `buffer.len()` for the duration of this call;
            // `bytes_read` is a valid `u32` local Win32 writes the actual count into.
            let ok = unsafe {
                ReadFile(
                    handle,
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    &mut bytes_read,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 || bytes_read == 0 {
                break;
            }

            let mut combined = carry.clone();
            combined.extend_from_slice(&buffer[..bytes_read as usize]);

            let min_search_start = carry.len().saturating_sub(MAX_START_MARKER_LEN - 1);
            let mut search_from = min_search_start;
            while let Some((pos, file_type)) = find_earliest_start(&combined, search_from, enabled_types) {
                let slice = &combined[pos..];
                let extraction_len = find_extraction_length(slice, file_type);
                write_extracted_file(destination, file_type, &slice[..extraction_len], progress)?;
                search_from = pos + extraction_len;
                if search_from >= combined.len() {
                    break;
                }
            }

            carry = if combined.len() > MAX_START_MARKER_LEN - 1 {
                combined[combined.len() - (MAX_START_MARKER_LEN - 1)..].to_vec()
            } else {
                combined
            };

            bytes_scanned += bytes_read as u64;
            progress.bytes_scanned = bytes_scanned;
            write_progress(result_path, progress)?;

            if bytes_scanned >= total_bytes {
                break;
            }
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
fn scan_volume(
    _drive: &str,
    _destination: &str,
    _enabled_types: &[FileType],
    _total_bytes: u64,
    _result_path: &Path,
    _progress: &mut RecoveryProgress,
) -> Result<(), String> {
    Err("Raw disk recovery scanning is only supported on Windows".to_string())
}
```

- [ ] **Step 3: Wire it into `lib.rs`**

In `crates/recovery/src/lib.rs`, change:

```rust
mod progress;
mod signatures;

pub use progress::{read_progress, RecoveryProgress, RecoveryStatus};
pub use signatures::{find_earliest_start, find_extraction_length, FileType, ALL_TYPES, MAX_START_MARKER_LEN};
```

to:

```rust
mod progress;
mod scan;
mod signatures;

pub use progress::{read_progress, RecoveryProgress, RecoveryStatus};
pub use scan::run_scan;
pub use signatures::{find_earliest_start, find_extraction_length, FileType, ALL_TYPES, MAX_START_MARKER_LEN};
```

- [ ] **Step 4: Confirm the crate builds**

Run: `cargo build -p explorer-recovery`
Expected: builds successfully.

- [ ] **Step 5: Run the full crate's existing tests to confirm nothing broke**

Run: `cargo test -p explorer-recovery`
Expected: PASS, 14 tests (10 from `signatures.rs` + 4 from `progress.rs`; `scan.rs` has none, per
this task's intro).

- [ ] **Step 6: Commit**

```bash
git add crates/recovery/src/scan.rs crates/recovery/src/lib.rs crates/recovery/src/progress.rs
git commit -m "Add the real raw-disk recovery scan"
```

---

### Task 4: `crates/recovery` — elevation relaunch (untested, real UAC)

**Files:**
- Create: `crates/recovery/src/elevation.rs`
- Modify: `crates/recovery/src/lib.rs`

No automated tests — triggering a real UAC prompt can't be exercised in `cargo test`, matching
`crates/terminal/src/elevation.rs`'s own precedent (its one test is a smoke test for
`is_elevated`, not a test of the relaunch itself). Verified by hand in Task 8.

- [ ] **Step 1: Write `elevation.rs`**

Create `crates/recovery/src/elevation.rs`:

```rust
//! Relaunches the app elevated (triggering the Windows UAC consent prompt) to run a headless
//! recovery scan as a separate process -- mirrors `crates/terminal/src/elevation.rs`'s
//! `relaunch_elevated_terminal`, which established this same `ShellExecuteW`/`"runas"` pattern
//! for the elevated terminal window. See `apps/desktop/src-tauri/src/main.rs`'s `--recovery-scan`
//! dispatch for what the relaunched process actually does.

#[cfg(windows)]
mod windows_impl {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;

    pub fn relaunch_recovery_scan(
        drive: &str,
        destination: &str,
        file_types: &[String],
        result_file: &str,
    ) -> Result<(), String> {
        let exe = std::env::current_exe()
            .map_err(|e| format!("Could not find own executable: {e}"))?;
        let exe_str = exe.to_string_lossy().to_string();

        let types_joined = file_types.join(",");
        let params = format!(
            "--recovery-scan --drive={} --dest={} --types={} --result-file={}",
            quote_arg(drive),
            quote_arg(destination),
            quote_arg(&types_joined),
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
    /// trailing backslashes; duplicated here rather than shared, since there's no existing
    /// shared string-utilities crate in this workspace and it's a small, self-contained function.
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
    pub fn relaunch_recovery_scan(
        _drive: &str,
        _destination: &str,
        _file_types: &[String],
        _result_file: &str,
    ) -> Result<(), String> {
        Err("Recovery scan elevation is only supported on Windows".to_string())
    }
}

#[cfg(not(windows))]
pub use stub::relaunch_recovery_scan;
#[cfg(windows)]
pub use windows_impl::relaunch_recovery_scan;
```

- [ ] **Step 2: Wire it into `lib.rs`**

In `crates/recovery/src/lib.rs`, change:

```rust
mod progress;
mod scan;
mod signatures;

pub use progress::{read_progress, RecoveryProgress, RecoveryStatus};
pub use scan::run_scan;
pub use signatures::{find_earliest_start, find_extraction_length, FileType, ALL_TYPES, MAX_START_MARKER_LEN};
```

to:

```rust
mod elevation;
mod progress;
mod scan;
mod signatures;

pub use elevation::relaunch_recovery_scan;
pub use progress::{read_progress, RecoveryProgress, RecoveryStatus};
pub use scan::run_scan;
pub use signatures::{find_earliest_start, find_extraction_length, FileType, ALL_TYPES, MAX_START_MARKER_LEN};
```

- [ ] **Step 3: Confirm the crate builds and all tests still pass**

Run: `cargo build -p explorer-recovery && cargo test -p explorer-recovery`
Expected: builds successfully, 14 tests pass (unchanged from Task 3 -- this task adds no tests).

- [ ] **Step 4: Commit**

```bash
git add crates/recovery/src/elevation.rs crates/recovery/src/lib.rs
git commit -m "Add the elevated recovery-scan relaunch"
```

---

### Task 5: `main.rs` dispatch for `--recovery-scan`

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the crate dependency**

In `apps/desktop/src-tauri/Cargo.toml`, add to the `[dependencies]` section, alongside the other
`explorer-*` path dependencies:

```toml
explorer-recovery = { path = "../../../crates/recovery" }
```

- [ ] **Step 2: Write the failing tests**

In `apps/desktop/src-tauri/src/main.rs`, add to the `tests` module, after the existing
`elevated_flag_with_cwd_extracts_the_path` test:

```rust
    #[test]
    fn normal_launch_is_not_recovery_scan() {
        let args = vec!["krampus-explorer.exe".to_string()];
        assert_eq!(parse_recovery_scan_args(&args), None);
    }

    #[test]
    fn recovery_scan_flag_extracts_all_four_arguments() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--recovery-scan".to_string(),
            "--drive=D:".to_string(),
            "--dest=C:\\Recovered".to_string(),
            "--types=jpeg,png".to_string(),
            "--result-file=C:\\Temp\\progress.json".to_string(),
        ];
        assert_eq!(
            parse_recovery_scan_args(&args),
            Some(RecoveryScanArgs {
                drive: "D:".to_string(),
                destination: "C:\\Recovered".to_string(),
                file_types: vec!["jpeg".to_string(), "png".to_string()],
                result_file: "C:\\Temp\\progress.json".to_string(),
            })
        );
    }

    #[test]
    fn recovery_scan_flag_missing_a_required_argument_yields_none() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--recovery-scan".to_string(),
            "--drive=D:".to_string(),
        ];
        assert_eq!(parse_recovery_scan_args(&args), None);
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test -p krampus-explorer recovery_scan`
Expected: FAIL — `parse_recovery_scan_args`/`RecoveryScanArgs` don't exist yet.

- [ ] **Step 4: Implement**

Replace the full contents of `apps/desktop/src-tauri/src/main.rs` with:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

/// Parses `--elevated-terminal` and an optional `--cwd=<path>` out of the process's command-line
/// arguments. Returns `None` for a normal app launch (the common case), `Some(cwd)` if this is
/// the elevated-terminal relaunch (see `explorer_terminal::relaunch_elevated_terminal`).
fn parse_elevated_terminal_args(args: &[String]) -> Option<Option<String>> {
    if !args.iter().any(|a| a == "--elevated-terminal") {
        return None;
    }
    let cwd = args
        .iter()
        .find_map(|a| a.strip_prefix("--cwd=").map(String::from));
    Some(cwd)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RecoveryScanArgs {
    drive: String,
    destination: String,
    file_types: Vec<String>,
    result_file: String,
}

/// Parses `--recovery-scan` and its four required arguments out of the process's command-line
/// arguments. Returns `None` for a normal app launch, or if `--recovery-scan` is present but
/// missing any required argument (treated as "not a recovery scan launch" rather than a partial/
/// broken one -- there's no sensible way to run a scan without all four). See
/// `explorer_recovery::relaunch_recovery_scan` for what constructs this command line.
fn parse_recovery_scan_args(args: &[String]) -> Option<RecoveryScanArgs> {
    if !args.iter().any(|a| a == "--recovery-scan") {
        return None;
    }
    let drive = args.iter().find_map(|a| a.strip_prefix("--drive=").map(String::from))?;
    let destination = args.iter().find_map(|a| a.strip_prefix("--dest=").map(String::from))?;
    let types = args.iter().find_map(|a| a.strip_prefix("--types=").map(String::from))?;
    let result_file =
        args.iter().find_map(|a| a.strip_prefix("--result-file=").map(String::from))?;

    Some(RecoveryScanArgs {
        drive,
        destination,
        file_types: types.split(',').map(String::from).collect(),
        result_file,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_launch_is_not_elevated_terminal() {
        let args = vec!["krampus-explorer.exe".to_string()];
        assert_eq!(parse_elevated_terminal_args(&args), None);
    }

    #[test]
    fn elevated_flag_alone_yields_no_cwd() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--elevated-terminal".to_string(),
        ];
        assert_eq!(parse_elevated_terminal_args(&args), Some(None));
    }

    #[test]
    fn elevated_flag_with_cwd_extracts_the_path() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--elevated-terminal".to_string(),
            "--cwd=C:\\Users\\boo".to_string(),
        ];
        assert_eq!(
            parse_elevated_terminal_args(&args),
            Some(Some("C:\\Users\\boo".to_string()))
        );
    }

    #[test]
    fn normal_launch_is_not_recovery_scan() {
        let args = vec!["krampus-explorer.exe".to_string()];
        assert_eq!(parse_recovery_scan_args(&args), None);
    }

    #[test]
    fn recovery_scan_flag_extracts_all_four_arguments() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--recovery-scan".to_string(),
            "--drive=D:".to_string(),
            "--dest=C:\\Recovered".to_string(),
            "--types=jpeg,png".to_string(),
            "--result-file=C:\\Temp\\progress.json".to_string(),
        ];
        assert_eq!(
            parse_recovery_scan_args(&args),
            Some(RecoveryScanArgs {
                drive: "D:".to_string(),
                destination: "C:\\Recovered".to_string(),
                file_types: vec!["jpeg".to_string(), "png".to_string()],
                result_file: "C:\\Temp\\progress.json".to_string(),
            })
        );
    }

    #[test]
    fn recovery_scan_flag_missing_a_required_argument_yields_none() {
        let args = vec![
            "krampus-explorer.exe".to_string(),
            "--recovery-scan".to_string(),
            "--drive=D:".to_string(),
        ];
        assert_eq!(parse_recovery_scan_args(&args), None);
    }
}
```

- [ ] **Step 5: Add `run_recovery_scan` to `lib.rs`**

In `apps/desktop/src-tauri/src/lib.rs`, add after the existing `run_elevated_terminal` function
(at the end of the file):

```rust

/// Entry point for the recovery-scan relaunch (see `explorer_recovery::relaunch_recovery_scan`
/// and `main.rs`'s `--recovery-scan` flag). Runs the scan directly and exits -- no Tauri, no
/// window, no webview. Progress and the final result are communicated back to the original
/// (unelevated) app process only through the JSON file at `result_file`, which it polls via the
/// `get_recovery_progress` Tauri command.
pub fn run_recovery_scan(drive: String, destination: String, file_types: Vec<String>, result_file: String) {
    if let Err(e) = explorer_recovery::run_scan(&drive, &destination, &file_types, &result_file) {
        eprintln!("Recovery scan failed: {e}");
        std::process::exit(1);
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p krampus-explorer`
Expected: PASS, 6 tests in `main.rs`'s test module (3 existing + 3 new).

- [ ] **Step 7: Confirm the whole workspace builds**

Run: `cargo build --workspace`
Expected: builds successfully.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/src/main.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "Add --recovery-scan headless dispatch"
```

---

### Task 6: Tauri commands `start_recovery_scan` / `get_recovery_progress`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the commands**

In `apps/desktop/src-tauri/src/commands.rs`, add near the top, alongside the other `use` lines:

```rust
use explorer_recovery::{read_progress, relaunch_recovery_scan, RecoveryProgress};
```

Then add, after the existing `delete_entries` command:

```rust
#[tauri::command]
pub fn start_recovery_scan(
    drive: String,
    destination: String,
    file_types: Vec<String>,
) -> Result<String, String> {
    let scan_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string());
    let result_file = std::env::temp_dir()
        .join(format!("krampus-recovery-{scan_id}.json"))
        .to_string_lossy()
        .to_string();
    relaunch_recovery_scan(&drive, &destination, &file_types, &result_file)?;
    Ok(result_file)
}

#[tauri::command]
pub fn get_recovery_progress(scan_id: String) -> Result<RecoveryProgress, String> {
    read_progress(std::path::Path::new(&scan_id))
}
```

Note `scan_id` here is the opaque result-file path returned by `start_recovery_scan` -- the
plugin stores whatever `start_recovery_scan` returns and passes it back verbatim, the same
"opaque identifier, not interpreted by the caller" convention as `TrashedItem.id`.

- [ ] **Step 2: Register the commands**

In `apps/desktop/src-tauri/src/lib.rs`, find the `commands::delete_entries,` line in the
`invoke_handler!` list and add right after it:

```rust
            commands::delete_entries,
            commands::start_recovery_scan,
            commands::get_recovery_progress,
```

- [ ] **Step 3: Confirm the whole workspace builds**

Run: `cargo build --workspace`
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "Add Tauri commands for starting and polling a recovery scan"
```

---

### Task 7: Plugin API — `system.drives` and `fs.recover`

**Files:**
- Modify: `apps/desktop/src/types/plugin.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.ts`
- Modify: `apps/desktop/src/plugins/pluginApi.test.ts`

- [ ] **Step 1: Add the new types and `PluginApi` methods to `types/plugin.ts`**

In `apps/desktop/src/types/plugin.ts`, add `DriveInfo` to the top-of-file import:

```ts
import type { EntryInfo } from "./filesystem";
```

becomes:

```ts
import type { DriveInfo, EntryInfo } from "./filesystem";
```

Then add, right after the existing `TrashedItem` interface:

```ts
export interface RecoveryProgress {
  status: "running" | "completed" | "failed";
  bytesScanned: number;
  totalBytes: number;
  /** Keyed by subfolder name ("jpeg", "png", "pdf", "zip", "mp3"). */
  filesFoundByType: Record<string, number>;
  /** Present only when `status` is `"failed"`. */
  error: string | null;
}
```

Then add to `PluginApi`, right after `getKnownFolder`:

```ts
  /** Present only if the plugin's manifest declares the "system.drives" permission. Lists every
   * detected drive -- the same data the sidebar's Drives section uses. */
  listDrives?: () => Promise<DriveInfo[]>;
  /** Present only if the plugin's manifest declares the "fs.recover" permission. Starts a
   * signature-based recovery scan of `drive` (e.g. "D:"), writing recovered files into
   * `destination` under per-type subfolders. `fileTypes` is a subset of "jpeg", "png", "pdf",
   * "zip", "mp3". Triggers a Windows UAC elevation prompt -- the scan runs in a separate,
   * elevated process. Resolves to an opaque scan id to pass to `getRecoveryProgress`; does not
   * wait for the scan itself to finish. */
  startRecoveryScan?: (drive: string, destination: string, fileTypes: string[]) => Promise<string>;
  /** Present only if the plugin's manifest declares the "fs.recover" permission. Polls the
   * current state of a scan started via `startRecoveryScan`. Rejects if called before the
   * elevated process has written its first progress update -- callers should tolerate a brief
   * initial failure window rather than treating it as fatal. */
  getRecoveryProgress?: (scanId: string) => Promise<RecoveryProgress>;
```

- [ ] **Step 2: Write the failing tests**

In `apps/desktop/src/plugins/pluginApi.test.ts`:

1. Add `RecoveryProgress` to the type-only import from `../types/plugin`.
2. Add to the `handlers()` mock, right after `getKnownFolder`:

```ts
    listDrives: vi.fn().mockResolvedValue([]),
    startRecoveryScan: vi.fn().mockResolvedValue("C:\\Temp\\krampus-recovery-123.json"),
    getRecoveryProgress: vi.fn().mockResolvedValue({
      status: "running",
      bytesScanned: 0,
      totalBytes: 100,
      filesFoundByType: {},
      error: null,
    } satisfies RecoveryProgress),
```

3. Add `"system.drives"` and `"fs.recover"` to `ALL_PERMISSIONS`.
4. Add to `ALL_METHODS`, right after `"getKnownFolder"`:

```ts
    "listDrives",
    "startRecoveryScan",
    "getRecoveryProgress",
```

5. Add two new rows to the `it.each` table, right after the `system.paths` row:

```ts
    ["system.drives", ["listDrives"]],
    ["fs.recover", ["startRecoveryScan", "getRecoveryProgress"]],
```

6. Add two dedicated forwarding tests, after the existing `getKnownFolder calls the handler with
   the folder name` test:

```ts
  it("startRecoveryScan calls the handler with drive, destination, and file types", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["fs.recover"]), h);

    await api.startRecoveryScan?.("D:", "C:\\Recovered", ["jpeg", "png"]);

    expect(h.startRecoveryScan).toHaveBeenCalledWith("D:", "C:\\Recovered", ["jpeg", "png"]);
  });

  it("getRecoveryProgress calls the handler with the scan id", async () => {
    const h = handlers();
    const api = createPluginApi(manifest(["fs.recover"]), h);

    await api.getRecoveryProgress?.("C:\\Temp\\krampus-recovery-123.json");

    expect(h.getRecoveryProgress).toHaveBeenCalledWith("C:\\Temp\\krampus-recovery-123.json");
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npm test -- --run pluginApi`
Expected: FAIL — `listDrives`/`startRecoveryScan`/`getRecoveryProgress` don't exist on
`PluginApiHandlers` yet.

- [ ] **Step 4: Wire `pluginApi.ts`**

In `apps/desktop/src/plugins/pluginApi.ts`:

1. Add `DriveInfo` and `RecoveryProgress` to the type-only import from `../types/plugin`.
2. Add to `PluginApiHandlers`, right after `getKnownFolder`:

```ts
  listDrives: () => Promise<DriveInfo[]>;
  startRecoveryScan: (drive: string, destination: string, fileTypes: string[]) => Promise<string>;
  getRecoveryProgress: (scanId: string) => Promise<RecoveryProgress>;
```

3. Add to `createPluginApi`, right after the `system.paths` block:

```ts
  if (has("system.drives")) {
    api.listDrives = () => handlers.listDrives();
  }
  if (has("fs.recover")) {
    api.startRecoveryScan = (drive, destination, fileTypes) =>
      handlers.startRecoveryScan(drive, destination, fileTypes);
    api.getRecoveryProgress = (scanId) => handlers.getRecoveryProgress(scanId);
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
git commit -m "Add system.drives and fs.recover to the plugin permission system"
```

---

### Task 8: Real handler wiring in `usePluginStore.ts`

**Files:**
- Modify: `apps/desktop/src/stores/usePluginStore.ts`

- [ ] **Step 1: Add the real handlers**

In `apps/desktop/src/stores/usePluginStore.ts`:

1. Add `DriveInfo` to the type-only import from `../types/filesystem`.
2. Add `RecoveryProgress` to the type-only import from `../types/plugin`.
3. Find the line `getKnownFolder: (folder) => invoke<string | null>("get_known_folder", {
   folder }),` and add right after it:

```ts
          listDrives: () => invoke<DriveInfo[]>("get_drives"),
          startRecoveryScan: (drive, destination, fileTypes) =>
            invoke<string>("start_recovery_scan", { drive, destination, fileTypes }),
          getRecoveryProgress: (scanId) =>
            invoke<RecoveryProgress>("get_recovery_progress", { scanId }),
```

- [ ] **Step 2: Typecheck and run the full test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/stores/usePluginStore.ts
git commit -m "Wire real listDrives and recovery-scan handlers into usePluginStore"
```

---

### Task 9: The `examples/plugins/recover-lost-data/` plugin

**Files:**
- Create: `examples/plugins/recover-lost-data/manifest.json`
- Create: `examples/plugins/recover-lost-data/frontend/index.js`
- Create: `examples/plugins/recover-lost-data/README.md`

- [ ] **Step 1: Create the manifest**

Create `examples/plugins/recover-lost-data/manifest.json`:

```json
{
  "id": "recover-lost-data",
  "name": "Recover Lost Data",
  "version": "1.0.0",
  "author": "Krampus Explorer",
  "permissions": ["ui.sidebar", "system.drives", "fs.recover", "ui.confirm", "nav.read"],
  "entry": "frontend/index.js"
}
```

- [ ] **Step 2: Create the entry file**

Create `examples/plugins/recover-lost-data/frontend/index.js`:

```js
// Entry point for the "Recover Lost Data" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", listDrives: "system.drives", startRecoveryScan/
// getRecoveryProgress: "fs.recover", confirm: "ui.confirm", getCurrentPath: "nav.read").

const FILE_TYPES = [
  { id: "jpeg", label: "JPEG images" },
  { id: "png", label: "PNG images" },
  { id: "pdf", label: "PDF documents" },
  { id: "zip", label: "ZIP archives (also covers DOCX/XLSX/PPTX)" },
  { id: "mp3", label: "MP3 audio" },
];

// A deliberately conservative assumed raw-read speed for the duration estimate -- this is a
// rough heuristic, not a measurement, so it's labeled as approximate in the UI rather than
// implying precision the app can't actually provide without probing the real device.
const ASSUMED_READ_SPEED_MB_PER_SEC = 50;

const POLL_INTERVAL_MS = 1000;

function formatSize(bytes) {
  if (bytes === null) return "unknown size";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function estimateDurationLabel(totalBytes) {
  if (!totalBytes) return "";
  const seconds = totalBytes / (ASSUMED_READ_SPEED_MB_PER_SEC * 1024 * 1024);
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `~${minutes} minute${minutes === 1 ? "" : "s"} (actual time depends on your drive's speed)`;
}

api.registerSidebarPanel({
  id: "recover-lost-data",
  title: "Recover Lost Data",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const driveSelect = document.createElement("select");
    driveSelect.style.padding = "4px 6px";
    driveSelect.style.fontSize = "12px";

    const durationLabel = document.createElement("p");
    durationLabel.style.color = "var(--fg-muted)";
    durationLabel.style.margin = "0";
    durationLabel.style.fontSize = "11px";

    const typesContainer = document.createElement("div");
    typesContainer.style.display = "flex";
    typesContainer.style.flexDirection = "column";
    typesContainer.style.gap = "2px";
    const typeCheckboxes = new Map();
    for (const type of FILE_TYPES) {
      const label = document.createElement("label");
      label.style.display = "flex";
      label.style.alignItems = "center";
      label.style.gap = "6px";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      typeCheckboxes.set(type.id, checkbox);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(type.label));
      typesContainer.appendChild(label);
    }

    const destInput = document.createElement("input");
    destInput.type = "text";
    destInput.placeholder = "Destination folder for recovered files";
    destInput.value = api.getCurrentPath?.() ?? "";
    destInput.style.padding = "4px 6px";
    destInput.style.fontSize = "12px";

    const startBtn = document.createElement("button");
    startBtn.textContent = "Start Scan";
    startBtn.style.padding = "5px 10px";
    startBtn.style.fontSize = "12px";
    startBtn.style.cursor = "pointer";

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

    function updateDurationLabel() {
      const drive = selectedDrive();
      durationLabel.textContent = drive ? estimateDurationLabel(drive.totalBytes) : "";
    }

    async function loadDrives() {
      try {
        drives = await api.listDrives();
        driveSelect.innerHTML = "";
        for (const drive of drives) {
          const option = document.createElement("option");
          option.value = drive.name;
          option.textContent = `${drive.name} (${formatSize(drive.totalBytes)})`;
          driveSelect.appendChild(option);
        }
        updateDurationLabel();
      } catch (error) {
        setStatus(String(error), true);
      }
    }

    driveSelect.addEventListener("change", updateDurationLabel);

    function stopPolling() {
      if (pollHandle !== null) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    }

    function summarizeFilesFound(filesFoundByType) {
      const parts = Object.entries(filesFoundByType)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => `${count} ${type}`);
      return parts.length > 0 ? parts.join(", ") : "none";
    }

    function pollProgress(scanId) {
      pollHandle = setInterval(async () => {
        let progress;
        try {
          progress = await api.getRecoveryProgress(scanId);
        } catch {
          // The elevated process may not have written its first progress update yet --
          // tolerate this rather than treating it as a fatal error.
          return;
        }

        const percent =
          progress.totalBytes > 0
            ? Math.min(100, Math.round((progress.bytesScanned / progress.totalBytes) * 100))
            : 0;

        if (progress.status === "running") {
          setStatus(
            `Scanning… ${percent}% (${summarizeFilesFound(progress.filesFoundByType)} found so far)`,
            false,
          );
        } else if (progress.status === "completed") {
          stopPolling();
          startBtn.disabled = false;
          setStatus(
            `Done. Recovered: ${summarizeFilesFound(progress.filesFoundByType)} -- saved to ${destInput.value}`,
            false,
          );
        } else if (progress.status === "failed") {
          stopPolling();
          startBtn.disabled = false;
          setStatus(progress.error ?? "Recovery scan failed.", true);
        }
      }, POLL_INTERVAL_MS);
    }

    startBtn.addEventListener("click", async () => {
      const drive = selectedDrive();
      if (!drive) {
        setStatus("Select a drive to scan.", true);
        return;
      }
      const destination = destInput.value.trim();
      if (!destination) {
        setStatus("Enter a destination folder for recovered files.", true);
        return;
      }
      const fileTypes = FILE_TYPES.filter((t) => typeCheckboxes.get(t.id)?.checked).map((t) => t.id);
      if (fileTypes.length === 0) {
        setStatus("Select at least one file type.", true);
        return;
      }

      const duration = estimateDurationLabel(drive.totalBytes);
      const ok = await api.confirm(
        `Scan ${drive.name} for recoverable files? This requires Administrator access and will ` +
          `take ${duration}. Recovered files will be saved to ${destination}.`,
      );
      if (!ok) return;

      startBtn.disabled = true;
      setStatus("Starting… (approve the Administrator prompt if one appears)", false);
      try {
        const scanId = await api.startRecoveryScan(drive.name, destination, fileTypes);
        pollProgress(scanId);
      } catch (error) {
        startBtn.disabled = false;
        setStatus(String(error), true);
      }
    });

    container.appendChild(driveSelect);
    container.appendChild(durationLabel);
    container.appendChild(typesContainer);
    container.appendChild(destInput);
    container.appendChild(startBtn);
    container.appendChild(status);

    void loadDrives();

    return () => {
      stopPolling();
    };
  },
});
```

- [ ] **Step 3: Create the README**

Create `examples/plugins/recover-lost-data/README.md`:

```md
# Recover Lost Data

Sidebar panel that scans a chosen drive's raw bytes for recognizable file signatures (JPEG, PNG,
PDF, ZIP, MP3) and extracts matches into a destination folder, for recovering files deleted
outside the Recycle Bin. Requires Administrator elevation (a UAC prompt appears when you click
Start Scan) since raw sector-level disk reads aren't available through normal file APIs.

This is signature-based carving, not filesystem-aware recovery: recovered files lose their
original names and folder structure (saved as `recovered_0001.jpg`, etc., in per-type
subfolders), and success depends on whether the original data has been overwritten since
deletion. The scan itself is read-only on the source drive -- there's no data-loss risk from
running it, only the time it takes and the disk space recovered files use at the destination.

## Permissions

- `ui.sidebar` — registers the panel.
- `system.drives` — lists available drives for the drive picker.
- `fs.recover` — starts the elevated scan and polls its progress.
- `ui.confirm` — confirms the target drive and estimated duration before starting.
- `nav.read` — pre-fills the destination field with the current folder.
```

- [ ] **Step 4: Typecheck and run the full frontend test suite**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass. (The new plugin's `frontend/index.js` isn't covered by
this -- it's runtime-loaded example plugin code, no build step, matching every other example
plugin's lack of automated coverage.)

- [ ] **Step 5: Commit**

```bash
git add examples/plugins/recover-lost-data/
git commit -m "Add the Recover Lost Data example plugin"
```

---

### Task 10: Docs and marketplace listing

**Files:**
- Modify: `docs/plugins.md`
- Modify: `marketplace.json`

- [ ] **Step 1: Document the new permissions in `docs/plugins.md`**

Add two rows to the permissions table, right after the `system.paths` row:

```md
| `system.drives` | `api.listDrives()` |
| `fs.recover` | `api.startRecoveryScan(drive, destination, fileTypes)`, `api.getRecoveryProgress(scanId)` |
```

Then add two new sections after `### \`system.paths\` methods`:

```md
### `system.drives` methods

- `listDrives(): Promise<DriveInfo[]>` — lists every detected drive, the same data the sidebar's
  Drives section uses (`name`, `path`, `mountPoint`, `totalBytes`, `freeBytes`).

### `fs.recover` methods

- `startRecoveryScan(drive: string, destination: string, fileTypes: string[]): Promise<string>`
  — starts a signature-based recovery scan of `drive` (e.g. `"D:"`), scanning for the given file
  types (`"jpeg"`, `"png"`, `"pdf"`, `"zip"`, `"mp3"`) and writing recovered files into
  `destination` under per-type subfolders (`destination/jpeg/recovered_0001.jpg`, etc.). Triggers
  a Windows UAC elevation prompt -- the scan itself runs in a separate, elevated process, since
  raw sector-level disk reads require Administrator rights. Resolves to an opaque scan id (pass
  it to `getRecoveryProgress` verbatim; don't parse or rely on its format) once the elevated
  process has been launched -- it does not wait for the scan to finish.
- `getRecoveryProgress(scanId: string): Promise<RecoveryProgress>` — polls the current state of a
  scan started via `startRecoveryScan`. `RecoveryProgress` has `status` (`"running"` |
  `"completed"` | `"failed"`), `bytesScanned`, `totalBytes`, `filesFoundByType` (keyed by
  subfolder name), and `error` (only set when `status` is `"failed"`). Rejects if called before
  the elevated process has written its first progress update -- a brief window right after
  starting, not a real error; callers should tolerate it rather than treating it as fatal.

Signature-based carving has no awareness of the original filesystem: recovered files lose their
original names, folder structure, and timestamps, and success depends on whether the underlying
disk sectors have been overwritten since deletion. The scan is read-only on the source drive.
```

- [ ] **Step 2: Add the new example plugin to the intro list**

In `docs/plugins.md`, find the `clear-unnecessary-files` bullet and add right after it:

```md
- `examples/plugins/recover-lost-data/` — signature-based file recovery via `system.drives`/`fs.recover`
```

- [ ] **Step 3: Add to `marketplace.json`**

In `marketplace.json` (repo root), add an entry after the `clear-unnecessary-files` entry:

```json
  {
    "id": "recover-lost-data",
    "name": "Recover Lost Data",
    "description": "Scans a drive for recoverable JPEG/PNG/PDF/ZIP/MP3 files (requires Administrator)."
  }
```

- [ ] **Step 4: Validate the JSON and typecheck**

Run: `node -e "JSON.parse(require('fs').readFileSync('marketplace.json'))" && node -e "JSON.parse(require('fs').readFileSync('examples/plugins/recover-lost-data/manifest.json'))"`
Expected: no output (both parse successfully).

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run`
Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add docs/plugins.md marketplace.json
git commit -m "Document system.drives/fs.recover and list the new plugin in the marketplace"
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full Rust workspace verification**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: fmt makes no unexpected changes (or auto-fixes formatting -- if it changes anything,
commit that separately as `git commit -m "Run cargo fmt"`), clippy is clean, all tests pass
(including the 14 new `explorer-recovery` tests and the 3 new `main.rs` tests).

- [ ] **Step 2: Full frontend verification**

Run: `cd apps/desktop && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: all green.

- [ ] **Step 3: Manual verification (cannot be automated)**

`scan.rs` and `elevation.rs` have no automated coverage (per Tasks 3-4's intros), and this whole
feature does raw, elevated disk I/O, so verify by hand against the running dev build --
**use the spare USB stick, not a real internal drive**, per the earlier discussion about safely
testing this and the later Drive Format/Secure Wipe plugins.

1. On the USB stick, create a few throwaway files of different recoverable types (e.g. copy a
   small JPEG, a PDF, and a ZIP onto it), then permanently delete them (Shift+Delete, or delete
   normally and empty the Recycle Bin) so they're gone from the filesystem's perspective but
   their data likely hasn't been overwritten yet.
2. Install/sync the Recover Lost Data plugin (via the marketplace, or copy
   `examples/plugins/recover-lost-data/` into your local plugins directory and use the "Local
   Plugins (dev)" sync tool in Settings if iterating locally).
3. Open the plugin panel. Confirm the drive dropdown lists your USB stick with a plausible size,
   and that selecting it shows a duration estimate.
4. Pick a destination folder, leave all file types checked, click Start Scan, and confirm the
   summary dialog states the correct drive/destination/duration. Confirm it.
5. Approve the UAC prompt that appears. Confirm the panel's status updates to show scanning
   progress (percentage climbing, files-found counts appearing) without you needing to do
   anything else.
6. Once complete, confirm the summary message matches what's actually in the destination folder
   (open it in the core file explorer) -- the recovered JPEG/PDF/ZIP should be there under
   `jpeg/`, `pdf/`, `zip/` subfolders, openable and not corrupted (for the small throwaway files
   used in this test, which is a reasonable single-chunk case to verify against).
7. Try declining the UAC prompt once (click Start Scan, then click "No" on the elevation dialog)
   and confirm the plugin shows a clear error ("Elevation was cancelled or could not start")
   rather than hanging or showing nothing.

- [ ] **Step 4: Report any failures as real bugs to fix**, not to note-and-move-past.
