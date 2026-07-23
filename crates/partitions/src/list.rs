use crate::model::DiskInfo;

/// Parses PowerShell-emitted JSON (an array of disk objects, shaped exactly like
/// `Vec<DiskInfo>`) into disk info. Used by the real `list_disks()` added in a later task.
#[allow(dead_code)] // wired up by list_disks() in a later task
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
