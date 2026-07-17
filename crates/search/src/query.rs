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

/// Hard cap on the number of rows a single search() call can return, applied regardless of
/// filters. Without this, a broad query (e.g. a single common letter) over a large indexed tree
/// can return an effectively unbounded result set -- in manual testing, rendering one such
/// unbounded result set drove a WebView2 renderer process past 9GB of memory. 500 is generous
/// enough to cover real search intent (matching in the many hundreds usually means the query
/// needs narrowing, not that the user wants to scroll through all of them) while keeping
/// worst-case IPC payload and render cost small. The frontend's `SEARCH_RESULT_CAP` in
/// `apps/desktop/src/stores/useSearchStore.ts` must be kept in sync with this value.
pub const SEARCH_RESULT_CAP: usize = 500;

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
    sql.push_str(" ORDER BY is_dir DESC, name COLLATE NOCASE ASC LIMIT ?");
    query_params.push(Box::new(SEARCH_RESULT_CAP as i64));

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

    /// Regression test for `escape_like`: without escaping, a literal "%" or "_" in the search
    /// term would be interpreted as a SQL LIKE wildcard, matching far more (or differently) than
    /// the user typed. A file named "100%done.txt" searched for by its literal "%" must not
    /// match unrelated files that merely happen to exist.
    #[test]
    fn search_treats_percent_and_underscore_in_the_query_as_literal_characters() {
        let source = tempdir().unwrap();
        fs::write(source.path().join("100%done.txt"), b"x").unwrap();
        fs::write(source.path().join("100Xdone.txt"), b"x").unwrap();
        fs::write(source.path().join("unrelated.txt"), b"x").unwrap();

        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let root = source.path().to_str().unwrap().to_string();
        build_index(&root, Some(&db_path)).unwrap();

        let filters = SearchFilters {
            name: Some("100%done".to_string()),
            ..Default::default()
        };
        let results = search(&root, &filters, Some(&db_path)).unwrap();

        let names: Vec<&str> = results.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["100%done.txt"]);
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

    /// Plan.md's search target is "instant where indexed" — this exercises the query path
    /// (not the filesystem walk, which build_index's own tests cover separately) against 5000
    /// already-indexed rows, inserted directly via SQL rather than real files so the test
    /// measures query latency, not disk I/O. 200ms is a generous regression-guard bound, not a
    /// literal target: it exists to catch an accidental full-table-scan (e.g. a filter that
    /// stops using the `(root, name)` index), not to certify "instant".
    #[test]
    fn search_scales_to_five_thousand_indexed_entries() {
        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let root = "C:\\synthetic-root";
        let mut conn = crate::db::open_connection(Some(&db_path)).unwrap();
        let tx = conn.transaction().unwrap();
        for i in 0..5000 {
            tx.execute(
                "INSERT INTO index_entries (root, path, name, is_dir, size, modified)
                 VALUES (?1, ?2, ?3, 0, ?4, 0)",
                rusqlite::params![
                    root,
                    format!("{root}\\unique_item_{i:05}.txt"),
                    format!("unique_item_{i:05}.txt"),
                    i as i64,
                ],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        drop(conn);

        // Every row's name is "unique_item_NNNNN.txt" with a fixed-width zero-padded number, so
        // searching for one row's full name can only match that row: a same-length numeric field
        // can't accidentally equal a different row's number as a substring.
        let filters = SearchFilters {
            name: Some("unique_item_02500.txt".to_string()),
            ..Default::default()
        };

        let start = std::time::Instant::now();
        let results = search(root, &filters, Some(&db_path)).unwrap();
        let elapsed = start.elapsed();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "unique_item_02500.txt");
        assert!(
            elapsed.as_millis() < 200,
            "search took {elapsed:?} against 5000 indexed rows, expected well under 200ms"
        );
    }

    #[test]
    fn search_caps_results_at_search_result_cap() {
        let db = tempdir().unwrap();
        let db_path = db.path().join("search.db");
        let root = "C:\\synthetic-root-cap";
        let mut conn = crate::db::open_connection(Some(&db_path)).unwrap();
        let tx = conn.transaction().unwrap();
        for i in 0..(SEARCH_RESULT_CAP + 50) {
            tx.execute(
                "INSERT INTO index_entries (root, path, name, is_dir, size, modified)
                 VALUES (?1, ?2, ?3, 0, ?4, 0)",
                rusqlite::params![
                    root,
                    format!("{root}\\item_{i:05}.txt"),
                    format!("item_{i:05}.txt"),
                    i as i64,
                ],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        drop(conn);

        let results = search(root, &SearchFilters::default(), Some(&db_path)).unwrap();

        assert_eq!(results.len(), SEARCH_RESULT_CAP);
    }
}
