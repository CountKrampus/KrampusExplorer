use rusqlite::Connection;
use std::path::{Path, PathBuf};

fn default_db_path() -> PathBuf {
    let mut dir = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    dir.push("Krampus Explorer");
    let _ = std::fs::create_dir_all(&dir);
    dir.push("search.db");
    dir
}

/// Opens (creating if needed) the search database and ensures its schema exists.
/// `db_path` overrides the default app-data location — tests always pass an explicit
/// temp-directory path so they never touch the real user database or each other.
pub fn open_connection(db_path: Option<&Path>) -> Result<Connection, String> {
    let path = match db_path {
        Some(p) => p.to_path_buf(),
        None => default_db_path(),
    };
    let conn =
        Connection::open(path).map_err(|e| format!("Could not open search database: {e}"))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS index_entries (
            root TEXT NOT NULL,
            path TEXT NOT NULL,
            name TEXT NOT NULL,
            is_dir INTEGER NOT NULL,
            size INTEGER,
            modified INTEGER,
            PRIMARY KEY (root, path)
        );
        CREATE INDEX IF NOT EXISTS idx_index_entries_root_name ON index_entries(root, name);

        CREATE TABLE IF NOT EXISTS search_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            root TEXT NOT NULL,
            query TEXT NOT NULL,
            searched_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS saved_searches (
            name TEXT PRIMARY KEY,
            root TEXT NOT NULL,
            query TEXT,
            file_type TEXT,
            min_size INTEGER,
            max_size INTEGER,
            modified_after INTEGER,
            modified_before INTEGER
        );
        ",
    )
    .map_err(|e| format!("Could not initialize search database: {e}"))
}
