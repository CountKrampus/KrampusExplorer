//! MongoDB browsing. Unlike SQLite (a local file we can freely create in tests), MongoDB is a
//! network service — there's no server available in this environment or CI to test against, so
//! test coverage here is necessarily limited to what doesn't require one: malformed input and
//! the unreachable-server failure path. The actual "does a real query against a real server
//! return the right documents" behavior is unverified by automated tests.

use futures_util::TryStreamExt;
use mongodb::bson::Document;
use mongodb::options::ClientOptions;
use mongodb::Client;
use std::time::Duration;

/// How long to wait for the server to respond before giving up. Applies to every operation
/// below, so a bad URI (unreachable host, wrong port, etc.) fails within a few seconds instead
/// of hanging the UI indefinitely.
const SERVER_SELECTION_TIMEOUT: Duration = Duration::from_secs(3);

async fn connect(uri: &str) -> Result<Client, String> {
    let mut options = ClientOptions::parse(uri)
        .await
        .map_err(|e| format!("Invalid MongoDB connection string: {e}"))?;
    options.server_selection_timeout = Some(SERVER_SELECTION_TIMEOUT);
    Client::with_options(options).map_err(|e| format!("Could not create MongoDB client: {e}"))
}

pub async fn list_mongo_databases(uri: &str) -> Result<Vec<String>, String> {
    let client = connect(uri).await?;
    client
        .list_database_names()
        .await
        .map_err(|e| format!("Could not list databases: {e}"))
}

pub async fn list_mongo_collections(uri: &str, db_name: &str) -> Result<Vec<String>, String> {
    let client = connect(uri).await?;
    client
        .database(db_name)
        .list_collection_names()
        .await
        .map_err(|e| format!("Could not list collections: {e}"))
}

/// Returns up to `limit` documents from `collection` as pretty-printed JSON strings (BSON
/// extended-JSON for types like ObjectId/Date that don't map directly to JSON).
pub async fn query_mongo_collection(
    uri: &str,
    db_name: &str,
    collection: &str,
    limit: i64,
) -> Result<Vec<String>, String> {
    let client = connect(uri).await?;
    let coll = client.database(db_name).collection::<Document>(collection);
    let mut cursor = coll
        .find(Document::new())
        .limit(limit)
        .await
        .map_err(|e| format!("Could not query collection: {e}"))?;

    let mut docs = Vec::new();
    while let Some(doc) = cursor
        .try_next()
        .await
        .map_err(|e| format!("Could not read document: {e}"))?
    {
        docs.push(
            serde_json::to_string(&doc).map_err(|e| format!("Could not format document: {e}"))?,
        );
    }
    Ok(docs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_a_malformed_connection_string_without_attempting_a_connection() {
        let result = list_mongo_databases("not a valid mongodb uri").await;

        assert!(result.is_err());
    }

    /// Slow-ish (bounded by SERVER_SELECTION_TIMEOUT, ~3s) but real: confirms an unreachable
    /// server produces a clean error rather than hanging forever. Port 1 is a reserved port
    /// nothing legitimate listens on.
    #[tokio::test]
    async fn fails_within_the_timeout_when_the_server_is_unreachable() {
        let result = list_mongo_databases("mongodb://127.0.0.1:1/?connectTimeoutMS=1000").await;

        assert!(result.is_err());
    }
}
