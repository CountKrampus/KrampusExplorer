//! Relaunches the app elevated (triggering the Windows UAC consent prompt) to run a headless
//! secure wipe as a separate process -- mirrors `crates/recovery/src/elevation.rs`'s
//! `relaunch_recovery_scan` (itself mirroring `crates/terminal/src/elevation.rs`'s original
//! `relaunch_elevated_terminal`). See `apps/desktop/src-tauri/src/main.rs`'s `--secure-wipe`
//! dispatch for what the relaunched process actually does.

#[cfg(windows)]
mod windows_impl {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;

    pub fn relaunch_secure_wipe(drive: &str, result_file: &str) -> Result<(), String> {
        let exe =
            std::env::current_exe().map_err(|e| format!("Could not find own executable: {e}"))?;
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
