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
    let normalized = drive
        .trim_end_matches('\\')
        .trim_end_matches(':')
        .to_uppercase();
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

    let letter = drive
        .trim_end_matches('\\')
        .trim_end_matches(':')
        .to_uppercase();
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
