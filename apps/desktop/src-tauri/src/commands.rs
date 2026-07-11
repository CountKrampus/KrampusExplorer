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
