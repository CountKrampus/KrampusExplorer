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
