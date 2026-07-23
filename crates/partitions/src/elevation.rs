//! Elevates `powershell.exe` per-operation to run a single partition-management action,
//! triggering the Windows UAC prompt, and waits for it to finish -- unlike Recovery/Wipe's
//! headless-relaunch-of-our-own-exe-with-polled-progress pattern, appropriate for those
//! multi-minute operations but overkill here, where most actions are near-instant. Uses
//! `ShellExecuteExW` (not the plain `ShellExecuteW` used elsewhere in this codebase) because only
//! the `Ex` variant, given `SEE_MASK_NOCLOSEPROCESS`, hands back a process handle to wait on.

#[cfg(windows)]
mod windows_impl {
    use std::path::Path;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{WaitForSingleObject, INFINITE};
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };

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

    fn run_elevated_powershell_file(script_path: &Path) -> Result<(), String> {
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
