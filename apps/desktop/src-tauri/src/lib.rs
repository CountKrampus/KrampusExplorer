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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
