//! Windows UAC elevation: checking the current process's elevation status, and relaunching the
//! app elevated for the "Open Terminal (Admin)" flow. See the design spec
//! (docs/superpowers/specs/2026-07-17-elevated-terminal-design.md) for why this relaunches the
//! whole app as a second process rather than elevating a single shell in place: portable-pty's
//! CreateProcess-based spawning can't cross the UAC elevation boundary on its own.

#[cfg(windows)]
mod windows_impl {
    use std::ffi::c_void;

    /// True if the current process is running elevated (as Administrator). Used by the
    /// terminal window to show "(Administrator)" in its title, regardless of how it ended up
    /// elevated -- this asks the OS directly rather than tracking the relaunch path.
    pub fn is_elevated() -> bool {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        unsafe {
            let mut token = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return false;
            }

            let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut size = 0u32;
            let ok = GetTokenInformation(
                token,
                TokenElevation,
                &mut elevation as *mut TOKEN_ELEVATION as *mut c_void,
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut size,
            );

            CloseHandle(token);

            ok != 0 && elevation.TokenIsElevated != 0
        }
    }

    /// Relaunches the current executable elevated (triggering the Windows UAC consent prompt),
    /// passing `--elevated-terminal` and, if given, `--cwd=<path>` on its command line. The
    /// relaunched process is a separate, independent OS process from this one.
    pub fn relaunch_elevated_terminal(cwd: Option<&str>) -> Result<(), String> {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;

        let exe = std::env::current_exe()
            .map_err(|e| format!("Could not find own executable: {e}"))?;
        let exe_str = exe.to_string_lossy().to_string();

        let mut params = "--elevated-terminal".to_string();
        if let Some(cwd) = cwd {
            params.push_str(&format!(" --cwd=\"{cwd}\""));
        }

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

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn to_wide_null_terminates() {
            assert_eq!(to_wide("hi"), vec![b'h' as u16, b'i' as u16, 0]);
        }

        #[test]
        fn to_wide_handles_empty_string() {
            assert_eq!(to_wide(""), vec![0]);
        }

        #[test]
        fn is_elevated_is_false_under_a_normal_test_run() {
            // cargo test doesn't run elevated, so this should reliably be false. A sane-default
            // smoke test (proves the Win32 call doesn't panic/misbehave), not a full correctness
            // proof of elevation detection under every OS scenario -- that needs manual
            // verification (a later task in the full plan, not this one).
            assert!(!is_elevated());
        }
    }
}

#[cfg(not(windows))]
mod stub {
    pub fn is_elevated() -> bool {
        false
    }

    pub fn relaunch_elevated_terminal(_cwd: Option<&str>) -> Result<(), String> {
        Err("Elevated relaunch is only supported on Windows".to_string())
    }
}

#[cfg(windows)]
pub use windows_impl::{is_elevated, relaunch_elevated_terminal};
#[cfg(not(windows))]
pub use stub::{is_elevated, relaunch_elevated_terminal};
