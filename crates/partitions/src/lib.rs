//! Windows disk partition management -- view, create, delete, resize, format, and relabel
//! partitions via PowerShell's `Storage` module. Read-only listing runs unelevated; every
//! mutation elevates `powershell.exe` per-operation (see `elevation.rs`) and refuses up front if
//! the target disk holds the Windows/system partition (see `system_disk.rs`).

mod list;
mod model;
mod system_disk;

pub use list::list_disks;
pub use model::{DiskInfo, PartitionInfo};
pub use system_disk::resolve_system_disk_number;
