use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    /// Unix epoch seconds as a string, or `None` if the OS didn't report a modified time.
    pub modified: Option<String>,
    /// Unix epoch seconds as a string, or `None` if the OS didn't report a creation time.
    pub created: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub entries: Vec<EntryInfo>,
    pub parent: Option<String>,
}

pub fn list_directory(path: &str) -> Result<DirectoryListing, String> {
    let dir = Path::new(path);
    let read_dir = std::fs::read_dir(dir).map_err(|e| format!("Could not read '{path}': {e}"))?;

    let mut entries = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Could not read entry in '{path}': {e}"))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Could not read metadata: {e}"))?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string());
        let created = metadata
            .created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string());

        entries.push(EntryInfo {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: if metadata.is_dir() {
                None
            } else {
                Some(metadata.len())
            },
            modified,
            created,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    let parent = dir.parent().map(|p| p.to_string_lossy().to_string());

    Ok(DirectoryListing { entries, parent })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn list_directory_returns_sorted_entries_with_parent() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("b_folder")).unwrap();
        fs::write(dir.path().join("a_file.txt"), b"hello").unwrap();
        fs::create_dir(dir.path().join("a_folder")).unwrap();

        let listing = list_directory(dir.path().to_str().unwrap()).unwrap();

        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["a_folder", "b_folder", "a_file.txt"]);
        assert!(listing.entries[0].is_dir);
        assert!(listing.entries[2].size.is_some());
        assert!(listing.entries[2].created.is_some());
        assert_eq!(
            listing.parent,
            dir.path().parent().map(|p| p.to_string_lossy().to_string())
        );
    }

    #[test]
    fn list_directory_returns_err_for_missing_path() {
        let result = list_directory("this-path-should-not-exist-12345");
        assert!(result.is_err());
    }

    /// Plan.md targets directory loading under 100ms. CI runners can be slower than a dev
    /// machine, so this asserts a looser 500ms regression-guard bound rather than the literal
    /// target — it exists to catch an accidental O(n^2) or per-entry syscall-storm regression,
    /// not to certify the 100ms target itself (that needs measuring against the real Tauri
    /// command round-trip, not just this function in isolation).
    #[test]
    fn list_directory_handles_five_thousand_entries_without_a_scaling_regression() {
        let dir = tempdir().unwrap();
        for i in 0..5000 {
            fs::write(dir.path().join(format!("file_{i:05}.txt")), b"x").unwrap();
        }

        let start = std::time::Instant::now();
        let listing = list_directory(dir.path().to_str().unwrap()).unwrap();
        let elapsed = start.elapsed();

        assert_eq!(listing.entries.len(), 5000);
        assert!(
            elapsed.as_millis() < 500,
            "list_directory took {elapsed:?} for 5000 entries, expected well under 500ms"
        );
    }
}
