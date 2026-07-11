use crate::db::open_connection;
use rusqlite::{params, Connection};
use std::path::Path;

/// Hard recursion cap. Directory trees this deep are vastly more likely to be a reparse-point
/// cycle we failed to detect than a genuine legitimate structure, so this is defense-in-depth
/// against a hang, not a realistic limit for normal folders.
const MAX_DEPTH: u32 = 40;

/// Recursively walks `root` and (re)builds its index entries. Unreadable subdirectories
/// (permissions, etc.) are skipped rather than failing the whole scan. Symlinks and Windows
/// reparse points (junctions, mount points) are indexed as entries but never recursed into —
/// following them can form cycles (e.g. stock Windows profile junctions like "Application
/// Data" or "My Documents" that point back into the tree being walked), which would otherwise
/// recurse forever.
pub fn build_index(root: &str, db_path: Option<&Path>) -> Result<usize, String> {
    let mut conn = open_connection(db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Could not start index transaction: {e}"))?;

    tx.execute("DELETE FROM index_entries WHERE root = ?1", params![root])
        .map_err(|e| format!("Could not clear old index: {e}"))?;

    let mut count = 0usize;
    walk(&tx, root, Path::new(root), &mut count, 0)?;

    tx.commit()
        .map_err(|e| format!("Could not commit index: {e}"))?;
    Ok(count)
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn walk(
    conn: &Connection,
    root: &str,
    dir: &Path,
    count: &mut usize,
    depth: u32,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Ok(());
    }

    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(()),
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        // DirEntry::metadata does not follow symlinks/reparse points — it describes the link
        // itself, which is exactly what we need to detect one without recursing through it.
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = metadata.is_dir();
        let is_link = is_reparse_point(&metadata);
        let size = if is_dir {
            None
        } else {
            Some(metadata.len() as i64)
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        let name = entry.file_name().to_string_lossy().to_string();
        let path_str = path.to_string_lossy().to_string();

        conn.execute(
            "INSERT OR REPLACE INTO index_entries (root, path, name, is_dir, size, modified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![root, path_str, name, is_dir as i64, size, modified],
        )
        .map_err(|e| format!("Could not index '{path_str}': {e}"))?;
        *count += 1;

        if is_dir && !is_link {
            walk(conn, root, &path, count, depth + 1)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn build_index_finds_nested_entries() {
        let source = tempdir().unwrap();
        fs::create_dir(source.path().join("sub")).unwrap();
        fs::write(source.path().join("a.txt"), b"hi").unwrap();
        fs::write(source.path().join("sub").join("b.txt"), b"nested").unwrap();

        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let root = source.path().to_str().unwrap();

        let count = build_index(root, Some(&db_path)).unwrap();

        assert_eq!(count, 3); // a.txt, sub/, sub/b.txt
    }

    #[test]
    fn build_index_replaces_stale_entries_on_rebuild() {
        let source = tempdir().unwrap();
        fs::write(source.path().join("a.txt"), b"hi").unwrap();

        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let root = source.path().to_str().unwrap();

        build_index(root, Some(&db_path)).unwrap();
        fs::remove_file(source.path().join("a.txt")).unwrap();
        fs::write(source.path().join("b.txt"), b"new").unwrap();

        let count = build_index(root, Some(&db_path)).unwrap();

        assert_eq!(
            count, 1,
            "rebuild should reflect current state, not accumulate"
        );
    }

    #[test]
    fn build_index_terminates_on_a_very_deep_tree() {
        let source = tempdir().unwrap();
        let mut dir = source.path().to_path_buf();
        for i in 0..(MAX_DEPTH + 20) {
            dir = dir.join(format!("d{i}"));
            fs::create_dir(&dir).unwrap();
        }

        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let root = source.path().to_str().unwrap();

        // Must return rather than hang; exact count isn't the point, termination is.
        let count = build_index(root, Some(&db_path)).unwrap();
        assert!(count > 0);
    }

    #[cfg(unix)]
    #[test]
    fn build_index_does_not_hang_on_a_symlink_cycle() {
        use std::os::unix::fs::symlink;

        let source = tempdir().unwrap();
        let sub = source.path().join("sub");
        fs::create_dir(&sub).unwrap();
        // A symlink inside `sub` pointing back to `source` forms a cycle a naive
        // recursive walker would follow forever.
        symlink(source.path(), sub.join("loop")).unwrap();

        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let root = source.path().to_str().unwrap();

        let count = build_index(root, Some(&db_path)).unwrap();

        assert_eq!(count, 2, "sub/ and sub/loop, with loop not recursed into");
    }

    #[cfg(windows)]
    #[test]
    fn build_index_does_not_hang_on_a_windows_junction_cycle() {
        let source = tempdir().unwrap();
        let sub = source.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let link = sub.join("loop");

        // Junctions (unlike symlinks) don't require elevated privileges to create, but the
        // `mklink` shell builtin may still be unavailable in some sandboxed environments —
        // skip rather than fail the suite if so, this test is about surviving a cycle if
        // one exists, not about asserting the environment can create one.
        let status = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                link.to_str().unwrap(),
                source.path().to_str().unwrap(),
            ])
            .status();
        if !matches!(status, Ok(s) if s.success()) {
            return;
        }

        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let root = source.path().to_str().unwrap();

        let count = build_index(root, Some(&db_path)).unwrap();

        assert_eq!(count, 2, "sub/ and sub/loop, with loop not recursed into");
    }
}
