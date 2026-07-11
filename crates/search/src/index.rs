use crate::db::open_connection;
use rusqlite::{params, Connection};
use std::path::Path;

/// Recursively walks `root` and (re)builds its index entries. Unreadable subdirectories
/// (permissions, etc.) are skipped rather than failing the whole scan.
pub fn build_index(root: &str, db_path: Option<&Path>) -> Result<usize, String> {
    let mut conn = open_connection(db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Could not start index transaction: {e}"))?;

    tx.execute("DELETE FROM index_entries WHERE root = ?1", params![root])
        .map_err(|e| format!("Could not clear old index: {e}"))?;

    let mut count = 0usize;
    walk(&tx, root, Path::new(root), &mut count)?;

    tx.commit()
        .map_err(|e| format!("Could not commit index: {e}"))?;
    Ok(count)
}

fn walk(conn: &Connection, root: &str, dir: &Path, count: &mut usize) -> Result<(), String> {
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(()),
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = metadata.is_dir();
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

        if is_dir {
            walk(conn, root, &path, count)?;
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
}
