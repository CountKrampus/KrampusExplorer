use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PartitionInfo {
    pub drive_letter: Option<String>,
    pub size_bytes: u64,
    pub offset_bytes: u64,
    pub filesystem: Option<String>,
    pub partition_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub number: u32,
    pub total_bytes: u64,
    pub is_system: bool,
    pub model: String,
    pub partitions: Vec<PartitionInfo>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partition_info_round_trips_through_json() {
        let original = PartitionInfo {
            drive_letter: Some("D:".to_string()),
            size_bytes: 500_000_000_000,
            offset_bytes: 1_048_576,
            filesystem: Some("NTFS".to_string()),
            partition_type: "Basic".to_string(),
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: PartitionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn partition_info_round_trips_with_no_drive_letter_or_filesystem() {
        let original = PartitionInfo {
            drive_letter: None,
            size_bytes: 104_857_600,
            offset_bytes: 0,
            filesystem: None,
            partition_type: "Reserved".to_string(),
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: PartitionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn disk_info_round_trips_with_multiple_partitions() {
        let original = DiskInfo {
            number: 0,
            total_bytes: 512_000_000_000,
            is_system: true,
            model: "Samsung SSD 970 EVO".to_string(),
            partitions: vec![
                PartitionInfo {
                    drive_letter: None,
                    size_bytes: 104_857_600,
                    offset_bytes: 1_048_576,
                    filesystem: Some("FAT32".to_string()),
                    partition_type: "System".to_string(),
                },
                PartitionInfo {
                    drive_letter: Some("C:".to_string()),
                    size_bytes: 511_000_000_000,
                    offset_bytes: 106_954_752,
                    filesystem: Some("NTFS".to_string()),
                    partition_type: "Basic".to_string(),
                },
            ],
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: DiskInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn disk_info_round_trips_with_no_partitions() {
        let original = DiskInfo {
            number: 1,
            total_bytes: 1_000_000_000_000,
            is_system: false,
            model: "WD Blue".to_string(),
            partitions: vec![],
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: DiskInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }
}
