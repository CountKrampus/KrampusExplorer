use explorer_filesystem::{list_directory, list_drives, DirectoryListing, DriveInfo};

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
