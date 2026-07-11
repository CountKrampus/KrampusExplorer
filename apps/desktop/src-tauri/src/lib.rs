mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            commands::search_files,
            commands::get_search_history,
            commands::clear_search_history,
            commands::save_search,
            commands::list_saved_searches,
            commands::delete_saved_search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
