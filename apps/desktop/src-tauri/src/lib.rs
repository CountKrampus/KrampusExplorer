mod commands;

use commands::PendingTerminalCwd;
use explorer_terminal::TerminalManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .manage(TerminalManager::new())
        .manage(PendingTerminalCwd(std::sync::Mutex::new(None)))
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_drives,
            commands::get_directory_listing,
            commands::get_default_start_path,
            commands::rename_entry,
            commands::delete_entry,
            commands::create_folder,
            commands::create_file,
            commands::copy_entry,
            commands::move_entry,
            commands::copy_entry_with_progress,
            commands::move_entry_with_progress,
            commands::search_files,
            commands::get_search_history,
            commands::clear_search_history,
            commands::save_search,
            commands::list_saved_searches,
            commands::delete_saved_search,
            commands::read_text_preview,
            commands::get_settings,
            commands::save_settings,
            commands::list_plugins,
            commands::read_plugin_entry,
            commands::install_plugin,
            commands::create_zip_archive,
            commands::extract_zip_archive,
            commands::scan_directory,
            commands::hash_files,
            commands::hash_file_all,
            commands::list_sqlite_tables,
            commands::query_sqlite_table,
            commands::list_mongo_databases,
            commands::list_mongo_collections,
            commands::query_mongo_collection,
            commands::git_status,
            commands::git_log,
            commands::run_command,
            commands::terminal_spawn,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
            commands::open_terminal_window,
            commands::take_pending_terminal_cwd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
