//! Directory listing, copy, move, delete, rename, metadata, and file watching.

mod drives;
mod format;
mod home;
mod known_folders;
mod listing;
mod operations;
mod trash_bin;

pub use drives::{list_drives, DriveInfo};
pub use format::{drive_letter_to_index, get_system_drive, is_system_drive, FormatOutcome};
pub use home::default_start_path;
pub use known_folders::{get_known_folder, KnownFolder};
pub use listing::{list_directory, DirectoryListing, EntryInfo};
pub use operations::{
    copy_entry, copy_entry_reporting, create_file, create_folder, delete_entry, move_entry,
    move_entry_reporting, rename_entry,
};
pub use trash_bin::{
    delete_entries, empty_trash, list_trash_items, purge_trash_item, restore_trash_item,
    TrashedItem,
};
