use explorer_filesystem::{list_directory, list_drives, DirectoryListing, DriveInfo};
use explorer_plugins::{
    CommandOutput, FileHash, GitCommit, GitFileStatus, MultiHash, PluginFile, PluginManifest,
    ScannedFile, TableData,
};
use explorer_preview::TextPreview;
use explorer_search::{HistoryEntry, SavedSearch, SearchFilters, SearchResult};
use explorer_settings::Settings;
use explorer_terminal::TerminalManager;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub copied: u64,
    pub total: u64,
}

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
pub fn copy_entry_with_progress(
    source: String,
    dest_dir: String,
    dest_name: Option<String>,
    overwrite: bool,
    on_progress: Channel<TransferProgress>,
) -> Result<String, String> {
    explorer_filesystem::copy_entry_reporting(
        &source,
        &dest_dir,
        dest_name.as_deref(),
        overwrite,
        |copied, total| {
            let _ = on_progress.send(TransferProgress { copied, total });
        },
    )
}

#[tauri::command]
pub fn move_entry_with_progress(
    source: String,
    dest_dir: String,
    dest_name: Option<String>,
    overwrite: bool,
    on_progress: Channel<TransferProgress>,
) -> Result<String, String> {
    explorer_filesystem::move_entry_reporting(
        &source,
        &dest_dir,
        dest_name.as_deref(),
        overwrite,
        |copied, total| {
            let _ = on_progress.send(TransferProgress { copied, total });
        },
    )
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

#[tauri::command]
pub fn install_plugin(plugin_id: String, files: Vec<PluginFile>) -> Result<(), String> {
    explorer_plugins::install_plugin(&plugin_id, &files, None)
}

#[tauri::command]
pub fn create_zip_archive(
    source_paths: Vec<String>,
    dest_zip_path: String,
) -> Result<String, String> {
    explorer_plugins::create_zip_archive(&source_paths, &dest_zip_path)
}

#[tauri::command]
pub fn extract_zip_archive(zip_path: String, dest_dir: String) -> Result<String, String> {
    explorer_plugins::extract_zip_archive(&zip_path, &dest_dir)
}

#[tauri::command]
pub fn scan_directory(root: String) -> Result<Vec<ScannedFile>, String> {
    explorer_plugins::scan_directory(&root)
}

#[tauri::command]
pub fn hash_files(paths: Vec<String>) -> Result<Vec<FileHash>, String> {
    explorer_plugins::hash_files(&paths)
}

#[tauri::command]
pub fn hash_file_all(path: String) -> Result<MultiHash, String> {
    explorer_plugins::hash_file_all(&path)
}

#[tauri::command]
pub fn list_sqlite_tables(db_path: String) -> Result<Vec<String>, String> {
    explorer_plugins::list_sqlite_tables(&db_path)
}

#[tauri::command]
pub fn query_sqlite_table(
    db_path: String,
    table: String,
    limit: u32,
    offset: u32,
) -> Result<TableData, String> {
    explorer_plugins::query_sqlite_table(&db_path, &table, limit, offset)
}

#[tauri::command]
pub async fn list_mongo_databases(uri: String) -> Result<Vec<String>, String> {
    explorer_plugins::list_mongo_databases(&uri).await
}

#[tauri::command]
pub async fn list_mongo_collections(uri: String, db_name: String) -> Result<Vec<String>, String> {
    explorer_plugins::list_mongo_collections(&uri, &db_name).await
}

#[tauri::command]
pub async fn query_mongo_collection(
    uri: String,
    db_name: String,
    collection: String,
    limit: i64,
) -> Result<Vec<String>, String> {
    explorer_plugins::query_mongo_collection(&uri, &db_name, &collection, limit).await
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<Vec<GitFileStatus>, String> {
    explorer_plugins::git_status(&repo_path)
}

#[tauri::command]
pub fn git_log(repo_path: String, limit: u32) -> Result<Vec<GitCommit>, String> {
    explorer_plugins::git_log(&repo_path, limit)
}

#[tauri::command]
pub fn run_command(command: String, cwd: String) -> Result<CommandOutput, String> {
    explorer_plugins::run_command(&command, &cwd)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalChunk {
    pub data: String,
}

#[tauri::command]
pub fn terminal_spawn(
    manager: tauri::State<TerminalManager>,
    cwd: Option<String>,
    on_output: Channel<TerminalChunk>,
) -> Result<String, String> {
    let leftover = std::sync::Mutex::new(Vec::<u8>::new());
    manager.spawn(cwd.as_deref(), move |bytes| {
        let mut buf = leftover.lock().unwrap();
        buf.extend_from_slice(&bytes);

        let valid_len = match std::str::from_utf8(&buf) {
            Ok(_) => buf.len(),
            Err(e) => e.valid_up_to(),
        };

        // If nothing is valid yet and the buffer has grown past the longest possible UTF-8
        // sequence (4 bytes), this isn't a split character -- it's genuinely invalid bytes.
        // Flush it lossily rather than buffering forever.
        let flush_len = if valid_len == 0 && buf.len() > 4 {
            buf.len()
        } else {
            valid_len
        };

        if flush_len == 0 {
            return;
        }

        let text = String::from_utf8_lossy(&buf[..flush_len]).to_string();
        buf.drain(..flush_len);
        drop(buf);

        let _ = on_output.send(TerminalChunk { data: text });
    })
}

#[tauri::command]
pub fn terminal_write(
    manager: tauri::State<TerminalManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    manager.write(&session_id, &data)
}

#[tauri::command]
pub fn terminal_resize(
    manager: tauri::State<TerminalManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(
    manager: tauri::State<TerminalManager>,
    session_id: String,
) -> Result<(), String> {
    manager.close(&session_id)
}

/// Creates the detached terminal window if it doesn't exist yet, else focuses the existing one.
/// `cwd` (the folder open in the explorer when the plugin's "Open Terminal" button was clicked)
/// is passed through the window URL so the terminal's first tab opens there.
#[tauri::command]
pub fn open_terminal_window(app: tauri::AppHandle, cwd: Option<String>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("terminal") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut url = "index.html?window=terminal".to_string();
    if let Some(cwd) = cwd {
        url.push_str("&cwd=");
        url.push_str(&urlencoding_encode(&cwd));
    }

    let window =
        tauri::WebviewWindowBuilder::new(&app, "terminal", tauri::WebviewUrl::App(url.into()))
            .title("Krampus Explorer — Terminal")
            .inner_size(900.0, 600.0)
            .min_inner_size(400.0, 300.0)
            .decorations(false)
            .build()
            .map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(manager) = app_handle.try_state::<TerminalManager>() {
                manager.close_all();
            }
        }
    });

    Ok(())
}

/// Minimal percent-encoding for the one thing a folder path needs escaped in a URL query
/// string: no external crate pulled in just for this.
fn urlencoding_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}
