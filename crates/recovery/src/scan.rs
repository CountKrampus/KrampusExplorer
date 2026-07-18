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
