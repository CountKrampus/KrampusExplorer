use crate::db::open_connection;
use rusqlite::ToSql;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilters {
    pub name: Option<String>,
    /// "file" or "folder"; anything else (including `None`) means "either".
    pub file_type: Option<String>,
    pub min_size: Option<i64>,
    pub max_size: Option<i64>,
    pub modified_after: Option<i64>,
    pub modified_before: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: Option<i64>,
    pub modified: Option<i64>,
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub fn search(
    root: &str,
    filters: &SearchFilters,
    db_path: Option<&Path>,
) -> Result<Vec<SearchResult>, String> {
    let conn = open_connection(db_path)?;

    let mut sql =
        String::from("SELECT path, name, is_dir, size, modified FROM index_entries WHERE root = ?");
    let mut query_params: Vec<Box<dyn ToSql>> = vec![Box::new(root.to_string())];

    if let Some(name) = &filters.name {
        if !name.is_empty() {
            sql.push_str(" AND name LIKE ? ESCAPE '\\'");
            query_params.push(Box::new(format!("%{}%", escape_like(name))));
        }
    }
    if let Some(file_type) = &filters.file_type {
        if file_type == "file" || file_type == "folder" {
            sql.push_str(" AND is_dir = ?");
            query_params.push(Box::new(i64::from(file_type == "folder")));
        }
    }
    if let Some(min_size) = filters.min_size {
        sql.push_str(" AND size >= ?");
        query_params.push(Box::new(min_size));
    }
    if let Some(max_size) = filters.max_size {
        sql.push_str(" AND size <= ?");
        query_params.push(Box::new(max_size));
    }
    if let Some(after) = filters.modified_after {
        sql.push_str(" AND modified >= ?");
        query_params.push(Box::new(after));
    }
    if let Some(before) = filters.modified_before {
        sql.push_str(" AND modified <= ?");
        query_params.push(Box::new(before));
    }
    sql.push_str(" ORDER BY is_dir DESC, name COLLATE NOCASE ASC");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Could not prepare search query: {e}"))?;
    let params_refs: Vec<&dyn ToSql> = query_params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(SearchResult {
                path: row.get(0)?,
                name: row.get(1)?,
                is_dir: row.get::<_, i64>(2)? != 0,
                size: row.get(3)?,
                modified: row.get(4)?,
            })
        })
        .map_err(|e| format!("Could not run search query: {e}"))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("Could not read search result: {e}"))?);
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::build_index;
    use std::fs;
    use tempfile::tempdir;

    fn setup() -> (tempfile::TempDir, tempfile::TempDir, String) {
        let source = tempdir().unwrap();
        fs::write(source.path().join("Report.txt"), vec![0u8; 100]).unwrap();
        fs::write(source.path().join("report_final.txt"), vec![0u8; 5000]).unwrap();
        fs::create_dir(source.path().join("reports")).unwrap();
        fs::write(source.path().join("photo.png"), vec![0u8; 200]).unwrap();

        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let root = source.path().to_str().unwrap().to_string();
        build_index(&root, Some(&db_path)).unwrap();
        (source, db, root)
    }

    #[test]
    fn search_matches_name_case_insensitively() {
        let (_source, db, root) = setup();
        let db_path = db.path().join("search.db");
        let filters = SearchFilters {
            name: Some("report".to_string()),
            ..Default::default()
        };

        let results = search(&root, &filters, Some(&db_path)).unwrap();

        let names: Vec<&str> = results.iter().map(|r| r.name.as_str()).collect();
        assert!(names.contains(&"Report.txt"));
        assert!(names.contains(&"report_final.txt"));
        assert!(names.contains(&"reports"));
        assert!(!names.contains(&"photo.png"));
    }

    #[test]
    fn search_filters_by_type() {
        let (_source, db, root) = setup();
        let db_path = db.path().join("search.db");
        let filters = SearchFilters {
            file_type: Some("folder".to_string()),
            ..Default::default()
        };

        let results = search(&root, &filters, Some(&db_path)).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "reports");
        assert!(results[0].is_dir);
    }

    #[test]
    fn search_filters_by_size_range() {
        let (_source, db, root) = setup();
        let db_path = db.path().join("search.db");
        let filters = SearchFilters {
            min_size: Some(1000),
            ..Default::default()
        };

        let results = search(&root, &filters, Some(&db_path)).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "report_final.txt");
    }

    #[test]
    fn search_with_no_filters_returns_everything_under_root() {
        let (_source, db, root) = setup();
        let db_path = db.path().join("search.db");

        let results = search(&root, &SearchFilters::default(), Some(&db_path)).unwrap();

        assert_eq!(results.len(), 4);
    }
}
