use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableData {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
}

pub fn list_sqlite_tables(db_path: &str) -> Result<Vec<String>, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Could not open database: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .map_err(|e| format!("Could not query tables: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Could not read tables: {e}"))?;

    let mut tables = Vec::new();
    for row in rows {
        tables.push(row.map_err(|e| format!("Could not read table name: {e}"))?);
    }
    Ok(tables)
}

fn value_to_string(value: ValueRef) -> Option<String> {
    match value {
        ValueRef::Null => None,
        ValueRef::Integer(i) => Some(i.to_string()),
        ValueRef::Real(f) => Some(f.to_string()),
        ValueRef::Text(t) => Some(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(b) => Some(format!("<{} bytes>", b.len())),
    }
}

/// Reads up to `limit` rows of `table` starting at `offset`. All values are stringified for
/// display (integers/reals via their own formatting, blobs as a byte-count placeholder).
///
/// `table` is validated against `list_sqlite_tables`'s own output before being interpolated
/// into SQL — SQLite doesn't support parameterized identifiers (only values), so this check is
/// what keeps an arbitrary `table` argument from being a SQL-injection vector.
pub fn query_sqlite_table(
    db_path: &str,
    table: &str,
    limit: u32,
    offset: u32,
) -> Result<TableData, String> {
    let known_tables = list_sqlite_tables(db_path)?;
    if !known_tables.iter().any(|t| t == table) {
        return Err(format!("No such table '{table}'"));
    }

    let conn = Connection::open(db_path).map_err(|e| format!("Could not open database: {e}"))?;
    let quoted = format!("\"{}\"", table.replace('"', "\"\""));
    let sql = format!("SELECT * FROM {quoted} LIMIT ?1 OFFSET ?2");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Could not query table: {e}"))?;
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let column_count = columns.len();

    let rows = stmt
        .query_map(rusqlite::params![limit, offset], |row| {
            let mut values = Vec::with_capacity(column_count);
            for i in 0..column_count {
                values.push(value_to_string(row.get_ref(i)?));
            }
            Ok(values)
        })
        .map_err(|e| format!("Could not read rows: {e}"))?;

    let mut result_rows = Vec::new();
    for row in rows {
        result_rows.push(row.map_err(|e| format!("Could not read row: {e}"))?);
    }
    Ok(TableData {
        columns,
        rows: result_rows,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn seed_db(path: &str) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);
             INSERT INTO people (name, age) VALUES ('Alice', 30);
             INSERT INTO people (name, age) VALUES ('Bob', 25);",
        )
        .unwrap();
    }

    #[test]
    fn list_sqlite_tables_finds_user_tables_only() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        seed_db(db_path.to_str().unwrap());

        let tables = list_sqlite_tables(db_path.to_str().unwrap()).unwrap();

        assert_eq!(tables, vec!["people".to_string()]);
    }

    #[test]
    fn query_sqlite_table_returns_columns_and_rows() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        seed_db(db_path.to_str().unwrap());

        let data = query_sqlite_table(db_path.to_str().unwrap(), "people", 10, 0).unwrap();

        assert_eq!(data.columns, vec!["id", "name", "age"]);
        assert_eq!(data.rows.len(), 2);
        assert_eq!(data.rows[0][1], Some("Alice".to_string()));
        assert_eq!(data.rows[1][1], Some("Bob".to_string()));
    }

    #[test]
    fn query_sqlite_table_formats_blobs_and_nulls_for_display() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE files (id INTEGER PRIMARY KEY, data BLOB, note TEXT);
             INSERT INTO files (data, note) VALUES (X'01020304', NULL);",
        )
        .unwrap();

        let data = query_sqlite_table(db_path.to_str().unwrap(), "files", 10, 0).unwrap();

        assert_eq!(data.rows[0][1], Some("<4 bytes>".to_string()));
        assert_eq!(data.rows[0][2], None);
    }

    #[test]
    fn query_sqlite_table_respects_limit_and_offset() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        seed_db(db_path.to_str().unwrap());

        let data = query_sqlite_table(db_path.to_str().unwrap(), "people", 1, 1).unwrap();

        assert_eq!(data.rows.len(), 1);
        assert_eq!(data.rows[0][1], Some("Bob".to_string()));
    }

    #[test]
    fn query_sqlite_table_rejects_unknown_table_name() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        seed_db(db_path.to_str().unwrap());

        // Exercises the injection-guard path: a name that isn't a real table, including one
        // shaped like an injection attempt, must be rejected before reaching SQL string
        // interpolation.
        let result = query_sqlite_table(
            db_path.to_str().unwrap(),
            "people\"; DROP TABLE people; --",
            10,
            0,
        );

        assert!(result.is_err());
        // Confirm the table really does still exist (the injection did not execute).
        assert_eq!(
            list_sqlite_tables(db_path.to_str().unwrap()).unwrap(),
            vec!["people".to_string()]
        );
    }
}
