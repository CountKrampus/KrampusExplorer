use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WipeStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WipeProgress {
    pub status: WipeStatus,
    pub bytes_written: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
}

pub(crate) fn write_progress(path: &Path, progress: &WipeProgress) -> Result<(), String> {
    let json = serde_json::to_string(progress)
        .map_err(|e| format!("Could not serialize progress: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("Could not write progress file: {e}"))
}

pub fn read_progress(path: &Path) -> Result<WipeProgress, String> {
    let json =
        std::fs::read_to_string(path).map_err(|e| format!("Could not read progress file: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("Could not parse progress file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_running_progress_through_a_real_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let original = WipeProgress {
            status: WipeStatus::Running,
            bytes_written: 1024,
            total_bytes: 2048,
            error: None,
        };

        write_progress(&path, &original).unwrap();
        assert_eq!(read_progress(&path).unwrap(), original);
    }

    #[test]
    fn round_trips_a_completed_progress() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let original = WipeProgress {
            status: WipeStatus::Completed,
            bytes_written: 2048,
            total_bytes: 2048,
            error: None,
        };

        write_progress(&path, &original).unwrap();
        assert_eq!(read_progress(&path).unwrap(), original);
    }

    #[test]
    fn round_trips_a_failed_progress_with_an_error_message() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let original = WipeProgress {
            status: WipeStatus::Failed,
            bytes_written: 512,
            total_bytes: 2048,
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
