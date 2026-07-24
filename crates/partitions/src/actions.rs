//! Pure script-building functions for partition mutations. Each function returns a PowerShell
//! fragment that assigns its outcome to a `$result` variable (a JSON string) rather than emitting
//! it directly, because a later task's `elevation.rs` wraps whatever these return inside a
//! `try`/`catch` that captures `$result` into a result file. These are plain string builders --
//! no process spawning -- which is what makes them testable in isolation.

/// Every mutating action's script ends by setting `$result` to a JSON string -- a later task's
/// `elevation.rs::run_elevated_action` wraps this fragment in a `try`/`catch` that writes
/// `$result` to a file it reads back afterward. Actions that don't naturally produce a
/// `PartitionInfo` (delete, relabel) just set `$result` to `'{}'`.
///
/// `selector` must be a COMPLETE, self-sufficient set of `Get-Partition` arguments (e.g.
/// `-DriveLetter 'E'`, or `-DiskNumber 1 -PartitionNumber 2`) -- never combine `-DiskNumber` with
/// `-DriveLetter` in the same call. Storage cmdlets like `Get-Partition`/`Set-Partition`/
/// `Resize-Partition`/`Remove-Partition` define `-DriveLetter` and `-DiskNumber` as belonging to
/// separate, mutually exclusive parameter sets (a drive letter alone already uniquely identifies
/// a partition system-wide) -- combining them fails at the PowerShell parameter-binding stage
/// with "Parameter set cannot be resolved using the specified named parameters," before the
/// cmdlet's own logic ever runs.
fn partition_result_expr(selector: &str) -> String {
    format!(
        "$p = Get-Partition {selector}\n\
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
        partition_result_expr(&format!(
            "-DiskNumber {disk_number} -PartitionNumber $p.PartitionNumber"
        ))
    )
}

pub(crate) fn delete_partition_script(drive_letter: &str) -> String {
    let letter = drive_letter.trim_end_matches(':').to_uppercase();
    format!(
        "Remove-Partition -DriveLetter '{letter}' -Confirm:$false\n\
$result = '{{}}'"
    )
}

pub(crate) fn resize_partition_script(drive_letter: &str, new_size_bytes: u64) -> String {
    let letter = drive_letter.trim_end_matches(':').to_uppercase();
    format!(
        "Resize-Partition -DriveLetter '{letter}' -Size {new_size_bytes}\n\
{}",
        partition_result_expr(&format!("-DriveLetter '{letter}'"))
    )
}

pub(crate) fn format_partition_script(drive_letter: &str, filesystem: &str) -> String {
    let letter = drive_letter.trim_end_matches(':').to_uppercase();
    format!(
        "Format-Volume -DriveLetter '{letter}' -FileSystem {filesystem} -Confirm:$false | Out-Null\n\
{}",
        partition_result_expr(&format!("-DriveLetter '{letter}'"))
    )
}

pub(crate) fn set_drive_letter_script(drive_letter: &str, new_letter: Option<&str>) -> String {
    let letter = drive_letter.trim_end_matches(':').to_uppercase();
    let action = match new_letter {
        Some(new) => format!(
            "Set-Partition -DriveLetter '{letter}' -NewDriveLetter '{}'",
            new.trim_end_matches(':').to_uppercase()
        ),
        None => {
            format!("Remove-PartitionAccessPath -DriveLetter '{letter}' -AccessPath '{letter}:\\'")
        }
    };
    format!("{action}\n$result = '{{}}'")
}

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
        Some(_) => Ok(()),
        None => Err("Could not determine the system disk -- refusing the action".to_string()),
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
    run_elevated_action(&delete_partition_script(drive_letter))?;
    Ok(())
}

pub fn resize_partition(
    disk_number: u32,
    drive_letter: &str,
    new_size_bytes: u64,
) -> Result<PartitionInfo, String> {
    ensure_not_system_disk(disk_number)?;
    let json = run_elevated_action(&resize_partition_script(drive_letter, new_size_bytes))?;
    parse_partition_result(&json)
}

pub fn format_partition(
    disk_number: u32,
    drive_letter: &str,
    filesystem: &str,
) -> Result<PartitionInfo, String> {
    ensure_not_system_disk(disk_number)?;
    let json = run_elevated_action(&format_partition_script(drive_letter, filesystem))?;
    parse_partition_result(&json)
}

pub fn set_drive_letter(
    disk_number: u32,
    drive_letter: &str,
    new_letter: Option<&str>,
) -> Result<(), String> {
    ensure_not_system_disk(disk_number)?;
    run_elevated_action(&set_drive_letter_script(drive_letter, new_letter))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_partition_script_with_an_explicit_drive_letter() {
        let script = new_partition_script(1, 1_048_576, 500_000_000_000, "NTFS", Some("E:"));
        assert!(script.contains(
            "New-Partition -DiskNumber 1 -Offset 1048576 -Size 500000000000 -DriveLetter 'E'"
        ));
        assert!(script.contains("Format-Volume -Partition $p -FileSystem NTFS -Confirm:$false"));
    }

    #[test]
    fn new_partition_script_without_a_drive_letter_auto_assigns_one() {
        let script = new_partition_script(1, 1_048_576, 500_000_000_000, "NTFS", None);
        assert!(script.contains("-AssignDriveLetter"));
        // The `New-Partition` invocation itself must not receive an explicit `-DriveLetter`
        // argument; the trailing `partition_result_expr` fragment legitimately references
        // `-DriveLetter` when querying the volume it ends up assigned to.
        let new_partition_line = script.lines().next().unwrap();
        assert!(!new_partition_line.contains("-DriveLetter"));
    }

    #[test]
    fn delete_partition_script_targets_the_right_letter() {
        let script = delete_partition_script("F:");
        assert!(script.contains("Remove-Partition -DriveLetter 'F' -Confirm:$false"));
        assert!(script.contains("$result = '{}'"));
        // -DriveLetter and -DiskNumber are mutually exclusive Storage-cmdlet parameter sets --
        // combining them is what caused "Parameter set cannot be resolved" in practice.
        assert!(!script.contains("-DiskNumber"));
    }

    #[test]
    fn resize_partition_script_sets_the_new_size() {
        let script = resize_partition_script("C:", 600_000_000_000);
        assert!(script.contains("Resize-Partition -DriveLetter 'C' -Size 600000000000"));
        assert!(!script.contains("-DiskNumber"));
    }

    #[test]
    fn format_partition_script_uses_the_requested_filesystem() {
        let script = format_partition_script("D:", "exFAT");
        assert!(script.contains("Format-Volume -DriveLetter 'D' -FileSystem exFAT -Confirm:$false"));
        assert!(!script.contains("-DiskNumber"));
    }

    #[test]
    fn set_drive_letter_script_reassigns_to_a_new_letter() {
        let script = set_drive_letter_script("E:", Some("G:"));
        assert!(script.contains("Set-Partition -DriveLetter 'E' -NewDriveLetter 'G'"));
        assert!(!script.contains("-DiskNumber"));
    }

    #[test]
    fn set_drive_letter_script_removes_the_letter_when_none_is_given() {
        let script = set_drive_letter_script("E:", None);
        assert!(script.contains("Remove-PartitionAccessPath -DriveLetter 'E' -AccessPath 'E:\\'"));
        assert!(!script.contains("-DiskNumber"));
    }

    #[test]
    fn drive_letters_are_normalized_to_uppercase_without_a_trailing_colon() {
        let script = delete_partition_script("f:");
        assert!(script.contains("-DriveLetter 'F'"));
    }
}
