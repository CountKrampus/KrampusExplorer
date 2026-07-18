use md5::Md5;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileHash {
    pub path: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MultiHash {
    pub md5: String,
    pub sha1: String,
    pub sha256: String,
}

/// Hard cap on the number of files a single scan_directory() call can return. Without this, a
/// recursive walk of a large root (a whole drive commonly has 200k-1M+ files) returns an
/// effectively unbounded result set -- in a real bug report, this froze the app for about a
/// minute (a slow Rust-side walk, a huge IPC payload, then a synchronous JS loop over the whole
/// array). 50,000 keeps worst-case payload/processing time bounded while staying generous for
/// legitimate large-folder analysis. Any plugin frontend calling `scanDirectory` should treat a
/// result of exactly this length as "possibly truncated, more may exist" -- see
/// examples/plugins/disk-usage-visualizer/frontend/index.js and
/// examples/plugins/duplicate-finder/frontend/index.js's matching `SCAN_FILE_CAP` constants.
pub const SCAN_FILE_CAP: usize = 50_000;

/// Recursively lists every *file* (not directory) under `root`, with its size. Symlinks are not
/// followed — `read_dir`'s `file_type()` reports a symlink as neither a file nor a directory
/// unless it's resolved, and we deliberately don't resolve it, to avoid infinite loops on a
/// symlink cycle.
///
/// A subdirectory this process can't read (permission-denied system folders like
/// `$RECYCLE.BIN\<sid>` or another user's protected Temp files are common when scanning a whole
/// drive) is skipped rather than failing the entire scan — matches `crates/search`'s own walker,
/// which has the same "one unreadable folder shouldn't abort the whole operation" reasoning.
pub fn scan_directory(root: &str) -> Result<Vec<ScannedFile>, String> {
    scan_directory_capped(root, SCAN_FILE_CAP)
}

fn scan_directory_capped(root: &str, cap: usize) -> Result<Vec<ScannedFile>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("'{root}' is not a directory"));
    }
    let mut results = Vec::new();
    walk(root_path, &mut results, cap);
    Ok(results)
}

fn walk(dir: &Path, results: &mut Vec<ScannedFile>, cap: usize) {
    if results.len() >= cap {
        return;
    }
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        if results.len() >= cap {
            return;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            walk(&path, results, cap);
        } else if file_type.is_file() {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            results.push(ScannedFile {
                path: path.to_string_lossy().to_string(),
                size,
            });
        }
    }
}

/// Hashes each of `paths` with BLAKE3, streaming the file contents rather than reading it fully
/// into memory first. A path that can't be opened or read (deleted, locked by another process, or
/// became inaccessible between the scan and the hash pass — all common when hashing hundreds of
/// thousands of candidates from a whole-drive scan) is skipped rather than failing the entire
/// batch; the caller gets every file that *could* be hashed instead of nothing.
///
/// Splits `paths` into contiguous chunks (one per available CPU core, capped at `paths.len()`)
/// and hashes each chunk on its own thread — a duplicate-finder scan can have hundreds of
/// same-size candidates to hash, and hashing is CPU-bound, so this uses more than one core
/// instead of hashing everything on the calling thread. Order is preserved: chunk boundaries
/// don't reorder paths, and chunks are reassembled in their original order.
pub fn hash_files(paths: &[String]) -> Result<Vec<FileHash>, String> {
    let thread_count = std::thread::available_parallelism()
        .map(std::num::NonZero::get)
        .unwrap_or(1)
        .min(paths.len().max(1));
    if thread_count <= 1 {
        return Ok(hash_files_sequential(paths));
    }

    let chunk_size = paths.len().div_ceil(thread_count);
    std::thread::scope(|scope| {
        let handles: Vec<_> = paths
            .chunks(chunk_size)
            .map(|chunk| scope.spawn(move || hash_files_sequential(chunk)))
            .collect();

        let mut results = Vec::with_capacity(paths.len());
        for handle in handles {
            let chunk_result = handle
                .join()
                .map_err(|_| "A hashing thread panicked".to_string())?;
            results.extend(chunk_result);
        }
        Ok(results)
    })
}

fn hash_files_sequential(paths: &[String]) -> Vec<FileHash> {
    paths
        .iter()
        .filter_map(|path| {
            let mut file = File::open(path).ok()?;
            let mut hasher = blake3::Hasher::new();
            hasher.update_reader(&mut file).ok()?;
            Some(FileHash {
                path: path.clone(),
                hash: hasher.finalize().to_hex().to_string(),
            })
        })
        .collect()
}

/// Computes MD5, SHA-1, and SHA-256 of `path` in one streaming pass — the algorithms a download
/// page's published checksum is actually likely to use, unlike the BLAKE3 hash `hash_files`
/// computes (which is only meant for comparing files to each other, not against an external
/// checksum). MD5 and SHA-1 are cryptographically broken but still what many sites publish, so
/// they're included for compatibility, not as a security recommendation.
pub fn hash_file_all(path: &str) -> Result<MultiHash, String> {
    let mut file = File::open(path).map_err(|e| format!("Could not open '{path}': {e}"))?;
    let mut md5 = Md5::new();
    let mut sha1 = Sha1::new();
    let mut sha256 = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Could not read '{path}': {e}"))?;
        if read == 0 {
            break;
        }
        md5.update(&buffer[..read]);
        sha1.update(&buffer[..read]);
        sha256.update(&buffer[..read]);
    }
    Ok(MultiHash {
        md5: hex::encode(md5.finalize()),
        sha1: hex::encode(sha1.finalize()),
        sha256: hex::encode(sha256.finalize()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn scan_directory_finds_nested_files_with_sizes() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), b"hello").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub").join("b.txt"), b"world!").unwrap();

        let mut files = scan_directory(dir.path().to_str().unwrap()).unwrap();
        files.sort_by_key(|a| a.size);

        assert_eq!(files.len(), 2);
        assert_eq!(files[0].size, 5);
        assert_eq!(files[1].size, 6);
    }

    #[test]
    fn scan_directory_errors_on_missing_path() {
        let result = scan_directory("this-path-should-not-exist-12345");
        assert!(result.is_err());
    }

    #[test]
    fn scan_directory_returns_empty_for_an_empty_folder() {
        let dir = tempdir().unwrap();
        let files = scan_directory(dir.path().to_str().unwrap()).unwrap();
        assert!(files.is_empty());
    }

    #[test]
    fn scan_directory_caps_results_at_the_given_limit() {
        let dir = tempdir().unwrap();
        for i in 0..10 {
            fs::write(dir.path().join(format!("file_{i}.txt")), b"x").unwrap();
        }

        let files = scan_directory_capped(dir.path().to_str().unwrap(), 5).unwrap();

        assert_eq!(files.len(), 5);
    }

    #[test]
    fn hash_files_gives_identical_files_the_same_hash() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a.txt");
        let b = dir.path().join("b.txt");
        fs::write(&a, b"duplicate content").unwrap();
        fs::write(&b, b"duplicate content").unwrap();

        let hashes = hash_files(&[
            a.to_string_lossy().to_string(),
            b.to_string_lossy().to_string(),
        ])
        .unwrap();

        assert_eq!(hashes[0].hash, hashes[1].hash);
    }

    #[test]
    fn hash_files_gives_different_files_different_hashes() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a.txt");
        let b = dir.path().join("b.txt");
        fs::write(&a, b"content one").unwrap();
        fs::write(&b, b"content two").unwrap();

        let hashes = hash_files(&[
            a.to_string_lossy().to_string(),
            b.to_string_lossy().to_string(),
        ])
        .unwrap();

        assert_ne!(hashes[0].hash, hashes[1].hash);
    }

    #[test]
    fn hash_files_skips_a_missing_file_instead_of_failing_the_whole_batch() {
        let dir = tempdir().unwrap();
        let ok_path = dir.path().join("ok.txt");
        fs::write(&ok_path, b"hello").unwrap();

        let hashes = hash_files(&[
            "this-file-should-not-exist-12345.txt".to_string(),
            ok_path.to_string_lossy().to_string(),
        ])
        .unwrap();

        assert_eq!(hashes.len(), 1);
        assert_eq!(hashes[0].path, ok_path.to_string_lossy().to_string());
    }

    #[test]
    fn hash_files_preserves_order_and_correctness_across_multiple_threads() {
        let dir = tempdir().unwrap();
        let mut paths = Vec::new();
        for i in 0..8 {
            let path = dir.path().join(format!("f{i}.txt"));
            fs::write(&path, format!("content-{i}").as_bytes()).unwrap();
            paths.push(path.to_string_lossy().to_string());
        }

        let hashes = hash_files(&paths).unwrap();

        assert_eq!(hashes.len(), paths.len());
        for (hash, path) in hashes.iter().zip(paths.iter()) {
            assert_eq!(&hash.path, path);
        }
        // Every file has distinct content, so every hash should be distinct too — this would
        // catch a bug where chunking accidentally hashed the wrong slice or duplicated work.
        let unique: std::collections::HashSet<_> = hashes.iter().map(|h| h.hash.clone()).collect();
        assert_eq!(unique.len(), hashes.len());
    }

    #[test]
    fn hash_file_all_matches_known_vectors_for_empty_input() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("empty.txt");
        fs::write(&path, b"").unwrap();

        let hash = hash_file_all(path.to_str().unwrap()).unwrap();

        // Well-known MD5/SHA-1/SHA-256 digests of the empty string.
        assert_eq!(hash.md5, "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(hash.sha1, "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(
            hash.sha256,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn hash_file_all_matches_known_vectors_for_abc() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("abc.txt");
        fs::write(&path, b"abc").unwrap();

        let hash = hash_file_all(path.to_str().unwrap()).unwrap();

        assert_eq!(hash.md5, "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(hash.sha1, "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(
            hash.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hash_file_all_errors_on_missing_file() {
        let result = hash_file_all("this-file-should-not-exist-12345.txt");
        assert!(result.is_err());
    }
}
