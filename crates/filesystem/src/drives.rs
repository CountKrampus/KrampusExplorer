use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub name: String,
    pub path: String,
    pub mount_point: String,
}

#[cfg(windows)]
pub fn list_drives() -> Vec<DriveInfo> {
    (b'A'..=b'Z')
        .filter_map(|letter| {
            let letter = letter as char;
            let root = format!("{letter}:\\");
            std::fs::metadata(&root).ok().map(|_| DriveInfo {
                name: format!("{letter}:"),
                path: root.clone(),
                mount_point: root,
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
}
