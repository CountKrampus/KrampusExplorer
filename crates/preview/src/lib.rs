//! Preview generation and thumbnail cache.

use serde::Serialize;
use std::io::Read;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPreview {
    pub content: String,
    pub truncated: bool,
}

/// Reads up to `max_bytes` of `path` as text, for preview purposes. Never reads more than
/// `max_bytes + 1` bytes regardless of the file's real size, so previewing a huge file stays
/// bounded in memory. Invalid UTF-8 is replaced lossily rather than failing — a preview is a
/// best-effort rendering, not a byte-perfect read.
pub fn read_text_preview(path: &str, max_bytes: usize) -> Result<TextPreview, String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("Could not read '{path}': {e}"))?;
    if metadata.is_dir() {
        return Err(format!("'{path}' is a directory"));
    }

    let file = std::fs::File::open(path).map_err(|e| format!("Could not open '{path}': {e}"))?;
    let mut buffer = Vec::with_capacity(max_bytes.min(64 * 1024));
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut buffer)
        .map_err(|e| format!("Could not read '{path}': {e}"))?;

    let truncated = buffer.len() > max_bytes;
    if truncated {
        buffer.truncate(max_bytes);
    }

    Ok(TextPreview {
        content: String::from_utf8_lossy(&buffer).to_string(),
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn reads_small_file_fully() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("a.txt");
        fs::write(&path, "hello world").unwrap();

        let preview = read_text_preview(path.to_str().unwrap(), 1024).unwrap();

        assert_eq!(preview.content, "hello world");
        assert!(!preview.truncated);
    }

    #[test]
    fn truncates_large_file_at_max_bytes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("big.txt");
        fs::write(&path, "a".repeat(1000)).unwrap();

        let preview = read_text_preview(path.to_str().unwrap(), 100).unwrap();

        assert_eq!(preview.content.len(), 100);
        assert!(preview.truncated);
    }

    #[test]
    fn rejects_directories() {
        let dir = tempdir().unwrap();

        let result = read_text_preview(dir.path().to_str().unwrap(), 1024);

        assert!(result.is_err());
    }

    #[test]
    fn rejects_nonexistent_path() {
        let result = read_text_preview("this-path-should-not-exist-12345", 1024);

        assert!(result.is_err());
    }

    #[test]
    fn replaces_invalid_utf8_lossily_instead_of_failing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("binary.dat");
        fs::write(&path, [0xFF, 0xFE, b'h', b'i']).unwrap();

        let preview = read_text_preview(path.to_str().unwrap(), 1024).unwrap();

        assert!(preview.content.contains("hi"));
    }
}
