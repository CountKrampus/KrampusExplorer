use crate::db::open_connection;
use crate::query::SearchFilters;
use rusqlite::params;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearch {
    pub name: String,
    pub root: String,
    pub query: Option<String>,
    pub file_type: Option<String>,
    pub min_size: Option<i64>,
    pub max_size: Option<i64>,
    pub modified_after: Option<i64>,
    pub modified_before: Option<i64>,
}

pub fn save_search(
    name: &str,
    root: &str,
    filters: &SearchFilters,
    db_path: Option<&Path>,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Saved search name cannot be empty".to_string());
    }
    let conn = open_connection(db_path)?;
    conn.execute(
        "INSERT OR REPLACE INTO saved_searches
            (name, root, query, file_type, min_size, max_size, modified_after, modified_before)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            name,
            root,
            filters.name,
            filters.file_type,
            filters.min_size,
            filters.max_size,
            filters.modified_after,
            filters.modified_before,
        ],
    )
    .map_err(|e| format!("Could not save search: {e}"))?;
    Ok(())
}

pub fn list_saved(db_path: Option<&Path>) -> Result<Vec<SavedSearch>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT name, root, query, file_type, min_size, max_size, modified_after, modified_before
             FROM saved_searches ORDER BY name COLLATE NOCASE ASC",
        )
        .map_err(|e| format!("Could not prepare saved searches query: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SavedSearch {
                name: row.get(0)?,
                root: row.get(1)?,
                query: row.get(2)?,
                file_type: row.get(3)?,
                min_size: row.get(4)?,
                max_size: row.get(5)?,
                modified_after: row.get(6)?,
                modified_before: row.get(7)?,
            })
        })
        .map_err(|e| format!("Could not read saved searches: {e}"))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("Could not read saved search row: {e}"))?);
    }
    Ok(results)
}

pub fn delete_saved(name: &str, db_path: Option<&Path>) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    let changed = conn
        .execute("DELETE FROM saved_searches WHERE name = ?1", params![name])
        .map_err(|e| format!("Could not delete saved search: {e}"))?;
    if changed == 0 {
        return Err(format!("No saved search named '{name}'"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn save_list_and_delete_round_trip() {
        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let filters = SearchFilters {
            name: Some("report".to_string()),
            file_type: Some("file".to_string()),
            ..Default::default()
        };

        save_search("My Reports", "C:\\Docs", &filters, Some(&db_path)).unwrap();

        let saved = list_saved(Some(&db_path)).unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].name, "My Reports");
        assert_eq!(saved[0].root, "C:\\Docs");
        assert_eq!(saved[0].query.as_deref(), Some("report"));

        delete_saved("My Reports", Some(&db_path)).unwrap();
        assert!(list_saved(Some(&db_path)).unwrap().is_empty());
    }

    #[test]
    fn save_search_rejects_empty_name() {
        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");

        let result = save_search("", "C:\\", &SearchFilters::default(), Some(&db_path));

        assert!(result.is_err());
    }

    #[test]
    fn delete_saved_errors_when_not_found() {
        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");

        let result = delete_saved("nonexistent", Some(&db_path));

        assert!(result.is_err());
    }

    #[test]
    fn saving_same_name_twice_replaces_it() {
        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let filters_a = SearchFilters {
            name: Some("a".to_string()),
            ..Default::default()
        };
        let filters_b = SearchFilters {
            name: Some("b".to_string()),
            ..Default::default()
        };

        save_search("Mine", "C:\\", &filters_a, Some(&db_path)).unwrap();
        save_search("Mine", "C:\\", &filters_b, Some(&db_path)).unwrap();

        let saved = list_saved(Some(&db_path)).unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].query.as_deref(), Some("b"));
    }
}
