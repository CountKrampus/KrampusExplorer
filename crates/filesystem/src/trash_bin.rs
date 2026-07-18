use serde::{Deserialize, Serialize};
use trash::os_limited::{list, metadata, purge_all, restore_all};
use trash::TrashItem;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrashedItem {
    pub id: String,
    pub name: String,
    pub original_parent: String,
    pub time_deleted: i64,
    pub size_bytes: Option<u64>,
}

fn to_trashed_item(item: &TrashItem) -> TrashedItem {
    let size_bytes = metadata(item).ok().and_then(|m| m.size.size());
    TrashedItem {
        id: item.id.to_string_lossy().to_string(),
        name: item.name.to_string_lossy().to_string(),
        original_parent: item.original_parent.to_string_lossy().to_string(),
        time_deleted: item.time_deleted,
        size_bytes,
    }
}

/// Lists everything currently in the OS Recycle Bin. Each item's size is fetched via a
/// per-item `metadata()` call (the `trash` crate's `list()` doesn't include it) -- a failed
/// metadata lookup just leaves that item's `size_bytes` as `None` rather than failing the whole
/// listing, matching this codebase's established "one bad entry shouldn't abort the operation"
/// pattern (see `crates/search`'s indexer and `crates/plugins`' `scan::walk`).
pub fn list_trash_items() -> Result<Vec<TrashedItem>, String> {
    let items = list().map_err(|e| format!("Could not list Recycle Bin items: {e}"))?;
    Ok(items.iter().map(to_trashed_item).collect())
}

/// `restore_all`/`purge_all` take actual `TrashItem` values, not bare ids, so every
/// single-item operation re-lists and finds the matching item by id first. The Recycle Bin is
/// small enough in normal use (dozens to low hundreds of items, not the hundreds of thousands a
/// whole-drive scan can produce) that re-listing per call is not a performance concern.
fn find_by_id(id: &str) -> Result<TrashItem, String> {
    let items = list().map_err(|e| format!("Could not list Recycle Bin items: {e}"))?;
    items
        .into_iter()
        .find(|item| item.id.to_string_lossy() == id)
        .ok_or_else(|| {
            format!(
                "No Recycle Bin item with id '{id}' -- it may have already been restored or permanently deleted"
            )
        })
}

pub fn restore_trash_item(id: &str) -> Result<(), String> {
    let item = find_by_id(id)?;
    restore_all(std::iter::once(item)).map_err(|e| format!("Could not restore item: {e}"))
}

pub fn purge_trash_item(id: &str) -> Result<(), String> {
    let item = find_by_id(id)?;
    purge_all(std::iter::once(item)).map_err(|e| format!("Could not permanently delete item: {e}"))
}

/// Permanently deletes everything currently in the Recycle Bin.
pub fn empty_trash() -> Result<(), String> {
    let items = list().map_err(|e| format!("Could not list Recycle Bin items: {e}"))?;
    purge_all(items).map_err(|e| format!("Could not empty the Recycle Bin: {e}"))
}

/// Sends every path in `paths` to the Recycle Bin in a single call, rather than one round-trip
/// per file -- important since a temp folder or browser cache can hold thousands of entries, and
/// per-file IPC calls would be both slow and (for a very large folder) a large-message-count
/// risk similar to the search/scan issues fixed earlier (see `SEARCH_RESULT_CAP`/`SCAN_FILE_CAP`
/// in `crates/search`/`crates/plugins`). A directory path in `paths` is moved to the Recycle Bin
/// as a whole (its contents don't need to be enumerated by the caller first).
pub fn delete_entries(paths: &[String]) -> Result<(), String> {
    trash::delete_all(paths).map_err(|e| format!("Could not delete entries: {e}"))
}
