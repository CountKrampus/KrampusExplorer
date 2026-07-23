use std::process::Command;

/// Resolves the physical disk number that owns the Windows/system partition, by combining
/// `explorer_filesystem::get_system_drive()` (already-tested logic, reused rather than
/// re-derived -- the same one-source-of-truth pattern Drive Format and Secure Wipe both follow
/// elsewhere in this codebase) with a fresh PowerShell lookup of which disk that drive letter
/// lives on.
///
/// Returns `Ok(None)` -- not an error -- if the system drive letter can't be resolved to a disk
/// number. Callers (a later task's `actions.rs::ensure_not_system_disk`) must treat `None` as
/// "unknown, therefore not provably safe," never as "no system disk exists, so anything goes."
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
