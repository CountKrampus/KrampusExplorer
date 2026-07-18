use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecoveryStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryProgress {
    pub status: RecoveryStatus,
    pub bytes_scanned: u64,
    pub total_bytes: u64,
    pub files_found_by_type: HashMap<String, u32>,
    pub error: Option<String>,
}

pub(crate) fn write_progress(path: &Path, progress: &RecoveryProgress) -> Result<(), String> {
    let json = serde_json::to_string(progress)
        .map_err(|e| format!("Could not serialize progress: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("Could not write progress file: {e}"))
}

pub fn read_progress(path: &Path) -> Result<RecoveryProgress, String> {
    let json =
        std::fs::read_to_string(path).map_err(|e| format!("Could not read progress file: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("Could not parse progress file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as StdHashMap;

    #[test]
    fn round_trips_a_running_progress_through_a_real_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let mut files_found = StdHashMap::new();
        files_found.insert("jpeg".to_string(), 3u32);

        let original = RecoveryProgress {
            status: RecoveryStatus::Running,
            bytes_scanned: 1024,
            total_bytes: 2048,
            files_found_by_type: files_found,
            error: None,
        };

        write_progress(&path, &original).unwrap();
        let loaded = read_progress(&path).unwrap();

        assert_eq!(loaded, original);
    }

    #[test]
    fn round_trips_a_completed_progress() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let original = RecoveryProgress {
            status: RecoveryStatus::Completed,
            bytes_scanned: 2048,
            total_bytes: 2048,
            files_found_by_type: StdHashMap::new(),
            error: None,
        };

        write_progress(&path, &original).unwrap();
        assert_eq!(read_progress(&path).unwrap(), original);
    }

    #[test]
    fn round_trips_a_failed_progress_with_an_error_message() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let original = RecoveryProgress {
            status: RecoveryStatus::Failed,
            bytes_scanned: 512,
            total_bytes: 2048,
            files_found_by_type: StdHashMap::new(),
            error: Some("Could not open drive".to_string()),
        };

        write_progress(&path, &original).unwrap();
        assert_eq!(read_progress(&path).unwrap(), original);
    }

    #[test]
    fn reading_a_missing_file_fails_with_a_clear_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("does-not-exist.json");
        let err = read_progress(&path).unwrap_err();
        assert!(err.contains("Could not read progress file"));
    }
}
