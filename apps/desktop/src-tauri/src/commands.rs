use explorer_filesystem::{list_directory, list_drives, DirectoryListing, DriveInfo};
use explorer_plugins::PluginManifest;
use explorer_preview::TextPreview;
use explorer_search::{HistoryEntry, SavedSearch, SearchFilters, SearchResult};
use explorer_settings::Settings;

/// Never reads more of a file than this for a text/markdown preview, regardless of the
/// file's real size on disk.
const MAX_TEXT_PREVIEW_BYTES: usize = 256 * 1024;

#[tauri::command]
pub fn get_drives() -> Vec<DriveInfo> {
    list_drives()
}

#[tauri::command]
pub fn get_directory_listing(path: String) -> Result<DirectoryListing, String> {
    list_directory(&path)
}

#[tauri::command]
pub fn get_default_start_path() -> String {
    explorer_filesystem::default_start_path()
}

#[tauri::command]
pub fn rename_entry(path: String, new_name: String) -> Result<String, String> {
    explorer_filesystem::rename_entry(&path, &new_name)
}

#[tauri::command]
pub fn delete_entry(path: String) -> Result<(), String> {
    explorer_filesystem::delete_entry(&path)
}

#[tauri::command]
pub fn create_folder(parent_path: String, name: String) -> Result<String, String> {
    explorer_filesystem::create_folder(&parent_path, &name)
}

#[tauri::command]
pub fn create_file(parent_path: String, name: String) -> Result<String, String> {
    explorer_filesystem::create_file(&parent_path, &name)
}

#[tauri::command]
pub fn copy_entry(
    source: String,
    dest_dir: String,
    dest_name: Option<String>,
    overwrite: bool,
) -> Result<String, String> {
    explorer_filesystem::copy_entry(&source, &dest_dir, dest_name.as_deref(), overwrite)
}

#[tauri::command]
pub fn move_entry(
    source: String,
    dest_dir: String,
    dest_name: Option<String>,
    overwrite: bool,
) -> Result<String, String> {
    explorer_filesystem::move_entry(&source, &dest_dir, dest_name.as_deref(), overwrite)
}

#[tauri::command]
pub fn search_files(root: String, filters: SearchFilters) -> Result<Vec<SearchResult>, String> {
    explorer_search::build_index(&root, None)?;
    let results = explorer_search::search(&root, &filters, None)?;
    if let Some(name) = &filters.name {
        explorer_search::record_search(&root, name, None)?;
    }
    Ok(results)
}

#[tauri::command]
pub fn get_search_history(limit: u32) -> Result<Vec<HistoryEntry>, String> {
    explorer_search::get_history(limit, None)
}

#[tauri::command]
pub fn clear_search_history() -> Result<(), String> {
    explorer_search::clear_history(None)
}

#[tauri::command]
pub fn save_search(name: String, root: String, filters: SearchFilters) -> Result<(), String> {
    explorer_search::save_search(&name, &root, &filters, None)
}

#[tauri::command]
pub fn list_saved_searches() -> Result<Vec<SavedSearch>, String> {
    explorer_search::list_saved(None)
}

#[tauri::command]
pub fn delete_saved_search(name: String) -> Result<(), String> {
    explorer_search::delete_saved(&name, None)
}

#[tauri::command]
pub fn read_text_preview(path: String) -> Result<TextPreview, String> {
    explorer_preview::read_text_preview(&path, MAX_TEXT_PREVIEW_BYTES)
}

#[tauri::command]
pub fn get_settings() -> Settings {
    explorer_settings::load_settings(None)
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    explorer_settings::save_settings(&settings, None)
}

#[tauri::command]
pub fn list_plugins() -> Vec<PluginManifest> {
    explorer_plugins::list_plugins(None)
}

#[tauri::command]
pub fn read_plugin_entry(path: String) -> Result<String, String> {
    explorer_plugins::read_entry(&path)
}
