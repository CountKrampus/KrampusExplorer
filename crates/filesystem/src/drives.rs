use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub name: String,
    pub path: String,
    pub mount_point: String,
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
}

#[cfg(windows)]
fn disk_space(root: &str) -> Option<(u64, u64)> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide: Vec<u16> = std::ffi::OsStr::new(root)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut free_bytes_available: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut total_free_bytes: u64 = 0;

    // SAFETY: `wide` is a valid null-terminated UTF-16 string for the lifetime of this call,
    // and the three out-parameters are valid `u64` locals GetDiskFreeSpaceExW is documented to
    // write through.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_bytes_available,
            &mut total_bytes,
            &mut total_free_bytes,
        )
    };

    if ok == 0 {
        None
    } else {
        Some((total_bytes, total_free_bytes))
    }
}

#[cfg(windows)]
pub fn list_drives() -> Vec<DriveInfo> {
    (b'A'..=b'Z')
        .filter_map(|letter| {
            let letter = letter as char;
            let root = format!("{letter}:\\");
            std::fs::metadata(&root).ok().map(|_| {
                let (total_bytes, free_bytes) = match disk_space(&root) {
                    Some((total, free)) => (Some(total), Some(free)),
                    None => (None, None),
                };
                DriveInfo {
                    name: format!("{letter}:"),
                    path: root.clone(),
                    mount_point: root,
                    total_bytes,
                    free_bytes,
                }
            })
        })
        .collect()
}

#[cfg(not(windows))]
pub fn list_drives() -> Vec<DriveInfo> {
    vec![DriveInfo {
        name: "Root".to_string(),
        path: "/".to_string(),
        mount_point: "/".to_string(),
        total_bytes: None,
        free_bytes: None,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_drives_returns_existing_paths() {
        let drives = list_drives();
        assert!(!drives.is_empty(), "expected at least one drive");
        for drive in &drives {
            assert!(
                std::path::Path::new(&drive.path).exists(),
                "drive path {} should exist",
                drive.path
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn list_drives_reports_plausible_disk_space_for_at_least_one_drive() {
        let drives = list_drives();
        let with_space = drives.iter().find(|d| d.total_bytes.is_some());
        let drive = with_space.expect("expected at least one drive to report disk space");

        let total = drive.total_bytes.unwrap();
        let free = drive.free_bytes.unwrap();
        assert!(total > 0, "total_bytes should be positive");
        assert!(free <= total, "free_bytes should not exceed total_bytes");
    }
}
