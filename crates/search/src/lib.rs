//! Indexing, search filters, and search history.

mod db;
mod history;
mod index;
mod query;
mod saved;

pub use history::{clear_history, get_history, record_search, HistoryEntry};
pub use index::build_index;
pub use query::{search, SearchFilters, SearchResult};
pub use saved::{delete_saved, list_saved, save_search, SavedSearch};
