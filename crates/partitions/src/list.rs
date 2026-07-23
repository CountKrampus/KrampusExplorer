use crate::model::DiskInfo;
use std::process::Command;

/// Lists every physical disk and its partitions. Runs **unelevated** -- `Get-Disk`/
/// `Get-Partition`/`Get-Volume` are read-only queries that don't need Administrator, unlike every
/// mutating operation that will be added in a later task. The script builds its own
/// `[PSCustomObject]`s with field names matching `DiskInfo`/`PartitionInfo` exactly, so parsing
/// on the Rust side is a direct deserialization with no intermediate mapping step.
pub fn list_disks() -> Result<Vec<DiskInfo>, String> {
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", LIST_DISKS_SCRIPT])
        .output()
        .map_err(|e| format!("Could not run PowerShell: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Could not list disks: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    parse_disks_json(&String::from_utf8_lossy(&output.stdout))
}

/// Wraps both the top-level disk collection and each disk's `partitions` collection in `@(...)`
/// so `ConvertTo-Json` always emits an array, even when there's exactly one disk or exactly one
/// partition -- without this, PowerShell collapses a single-element array to a bare JSON object,
/// which would fail to deserialize as `Vec<DiskInfo>`/`Vec<PartitionInfo>`.
const LIST_DISKS_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$systemLetter = $env:SystemDrive.TrimEnd(':')
$systemDiskNumber = (Get-Partition -DriveLetter $systemLetter -ErrorAction SilentlyContinue).DiskNumber

$disks = Get-Disk | ForEach-Object {
    $disk = $_
    $partitions = @(Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | ForEach-Object {
        $part = $_
        $volume = if ($part.DriveLetter) { Get-Volume -DriveLetter $part.DriveLetter -ErrorAction SilentlyContinue } else { $null }
        [PSCustomObject]@{
            driveLetter   = if ($part.DriveLetter) { "$($part.DriveLetter):" } else { $null }
            sizeBytes     = $part.Size
            offsetBytes   = $part.Offset
            filesystem    = if ($volume) { $volume.FileSystem } else { $null }
            partitionType = $part.Type.ToString()
        }
    })
    [PSCustomObject]@{
        number     = $disk.Number
        totalBytes = $disk.Size
        isSystem   = ($null -ne $systemDiskNumber -and $disk.Number -eq $systemDiskNumber)
        model      = $disk.FriendlyName
        partitions = $partitions
    }
}
@($disks) | ConvertTo-Json -Depth 6
"#;

/// Parses PowerShell-emitted JSON (an array of disk objects, shaped exactly like
/// `Vec<DiskInfo>`) into disk info. Used by the real `list_disks()` added in a later task.
pub(crate) fn parse_disks_json(json: &str) -> Result<Vec<DiskInfo>, String> {
    let trimmed = json.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(trimmed).map_err(|e| format!("Could not parse disk list: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_two_disks_with_mixed_partition_counts() {
        let json = r#"[
            {
                "number": 0,
                "totalBytes": 512000000000,
                "isSystem": true,
                "model": "Samsung SSD 970 EVO",
                "partitions": [
                    { "driveLetter": null, "sizeBytes": 104857600, "offsetBytes": 1048576, "filesystem": "FAT32", "partitionType": "System" },
                    { "driveLetter": "C:", "sizeBytes": 511000000000, "offsetBytes": 106954752, "filesystem": "NTFS", "partitionType": "Basic" }
                ]
            },
            {
                "number": 1,
                "totalBytes": 1000000000000,
                "isSystem": false,
                "model": "WD Blue",
                "partitions": [
                    { "driveLetter": "D:", "sizeBytes": 1000000000000, "offsetBytes": 1048576, "filesystem": "NTFS", "partitionType": "Basic" }
                ]
            }
        ]"#;

        let disks = parse_disks_json(json).unwrap();

        assert_eq!(disks.len(), 2);
        assert_eq!(disks[0].number, 0);
        assert!(disks[0].is_system);
        assert_eq!(disks[0].partitions.len(), 2);
        assert_eq!(disks[0].partitions[0].drive_letter, None);
        assert_eq!(disks[1].partitions[0].drive_letter, Some("D:".to_string()));
    }

    #[test]
    fn parses_a_disk_with_no_partitions() {
        let json = r#"[{"number":2,"totalBytes":8000000000,"isSystem":false,"model":"USB Drive","partitions":[]}]"#;

        let disks = parse_disks_json(json).unwrap();

        assert_eq!(disks.len(), 1);
        assert!(disks[0].partitions.is_empty());
    }

    #[test]
    fn parses_an_empty_disk_list() {
        assert_eq!(parse_disks_json("[]").unwrap(), Vec::new());
    }

    #[test]
    fn empty_output_parses_as_an_empty_list_rather_than_an_error() {
        assert_eq!(parse_disks_json("").unwrap(), Vec::new());
        assert_eq!(parse_disks_json("   \n").unwrap(), Vec::new());
    }

    #[test]
    fn rejects_genuinely_malformed_json() {
        assert!(parse_disks_json("{not valid json").is_err());
    }
}
