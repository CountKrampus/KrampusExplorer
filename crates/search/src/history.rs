use crate::db::open_connection;
use rusqlite::params;
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub root: String,
    pub query: String,
    pub searched_at: i64,
}

/// Records a search in history. A blank query is not recorded (nothing meaningful to repeat).
pub fn record_search(root: &str, query: &str, db_path: Option<&Path>) -> Result<(), String> {
    if query.trim().is_empty() {
        return Ok(());
    }
    let conn = open_connection(db_path)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO search_history (root, query, searched_at) VALUES (?1, ?2, ?3)",
        params![root, query, now],
    )
    .map_err(|e| format!("Could not record search history: {e}"))?;
    Ok(())
}

pub fn get_history(limit: u32, db_path: Option<&Path>) -> Result<Vec<HistoryEntry>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT root, query, searched_at FROM search_history ORDER BY searched_at DESC, id DESC LIMIT ?1",
        )
        .map_err(|e| format!("Could not prepare history query: {e}"))?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(HistoryEntry {
                root: row.get(0)?,
                query: row.get(1)?,
                searched_at: row.get(2)?,
            })
        })
        .map_err(|e| format!("Could not read search history: {e}"))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("Could not read history row: {e}"))?);
    }
    Ok(results)
}

pub fn clear_history(db_path: Option<&Path>) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute("DELETE FROM search_history", [])
        .map_err(|e| format!("Could not clear search history: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn record_and_get_history_returns_most_recent_first() {
        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");

        record_search("C:\\", "first", Some(&db_path)).unwrap();
        record_search("C:\\", "second", Some(&db_path)).unwrap();

        let history = get_history(10, Some(&db_path)).unwrap();

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].query, "second");
        assert_eq!(history[1].query, "first");
    }

    #[test]
    fn record_search_ignores_blank_query() {
        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");

        record_search("C:\\", "   ", Some(&db_path)).unwrap();

        let history = get_history(10, Some(&db_path)).unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn get_history_respects_limit() {
        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        for i in 0..5 {
            record_search("C:\\", &format!("query{i}"), Some(&db_path)).unwrap();
        }

        let history = get_history(2, Some(&db_path)).unwrap();

        assert_eq!(history.len(), 2);
    }

    #[test]
    fn clear_history_empties_it() {
        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        record_search("C:\\", "something", Some(&db_path)).unwrap();

        clear_history(Some(&db_path)).unwrap();

        assert!(get_history(10, Some(&db_path)).unwrap().is_empty());
    }
}
