//! Pure script-building functions for partition mutations. Each function returns a PowerShell
//! fragment that assigns its outcome to a `$result` variable (a JSON string) rather than emitting
//! it directly, because a later task's `elevation.rs` wraps whatever these return inside a
//! `try`/`catch` that captures `$result` into a result file. These are plain string builders --
//! no process spawning -- which is what makes them testable in isolation.

/// Every mutating action's script ends by setting `$result` to a JSON string -- a later task's
/// `elevation.rs::run_elevated_action` wraps this fragment in a `try`/`catch` that writes
/// `$result` to a file it reads back afterward. Actions that don't naturally produce a
/// `PartitionInfo` (delete, relabel) just set `$result` to `'{}'`.
#[allow(dead_code, reason = "wired up by a later task (elevation.rs)")]
fn partition_result_expr(disk_number: u32, locator: &str) -> String {
    format!(
        "$p = Get-Partition -DiskNumber {disk_number} {locator}\n\
$v = if ($p.DriveLetter) {{ Get-Volume -DriveLetter $p.DriveLetter -ErrorAction SilentlyContinue }} else {{ $null }}\n\
$result = [PSCustomObject]@{{ driveLetter = if ($p.DriveLetter) {{ \"$($p.DriveLetter):\" }} else {{ $null }}; sizeBytes = $p.Size; offsetBytes = $p.Offset; filesystem = if ($v) {{ $v.FileSystem }} else {{ $null }}; partitionType = $p.Type.ToString() }} | ConvertTo-Json -Compress"
    )
}

#[allow(dead_code, reason = "wired up by a later task (elevation.rs)")]
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

#[allow(dead_code, reason = "wired up by a later task (elevation.rs)")]
pub(crate) fn delete_partition_script(disk_number: u32, drive_letter: &str) -> String {
    let letter = drive_letter.trim_end_matches(':').to_uppercase();
    format!(
        "Remove-Partition -DiskNumber {disk_number} -DriveLetter '{letter}' -Confirm:$false\n\
$result = '{{}}'"
    )
}

#[allow(dead_code, reason = "wired up by a later task (elevation.rs)")]
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

#[allow(dead_code, reason = "wired up by a later task (elevation.rs)")]
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

#[allow(dead_code, reason = "wired up by a later task (elevation.rs)")]
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
        // The `New-Partition` invocation itself must not receive an explicit `-DriveLetter`
        // argument; the trailing `partition_result_expr` fragment legitimately references
        // `-DriveLetter` when querying the volume it ends up assigned to.
        let new_partition_line = script.lines().next().unwrap();
        assert!(!new_partition_line.contains("-DriveLetter"));
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
