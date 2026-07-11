use std::path::Path;

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." {
        return Err(format!("'{name}' is not a valid name"));
    }
    if name.contains('/') || name.contains('\\') {
        return Err("Name cannot contain path separators".to_string());
    }
    Ok(())
}

pub fn rename_entry(path: &str, new_name: &str) -> Result<String, String> {
    validate_name(new_name)?;
    let old_path = Path::new(path);
    let parent = old_path
        .parent()
        .ok_or_else(|| format!("'{path}' has no parent directory"))?;
    let new_path = parent.join(new_name);
    if new_path.exists() {
        return Err(format!("'{new_name}' already exists"));
    }
    std::fs::rename(old_path, &new_path).map_err(|e| format!("Could not rename '{path}': {e}"))?;
    Ok(new_path.to_string_lossy().to_string())
}

pub fn delete_entry(path: &str) -> Result<(), String> {
    trash::delete(path).map_err(|e| format!("Could not delete '{path}': {e}"))
}

pub fn create_folder(parent_path: &str, name: &str) -> Result<String, String> {
    validate_name(name)?;
    let new_path = Path::new(parent_path).join(name);
    if new_path.exists() {
        return Err(format!("'{name}' already exists"));
    }
    std::fs::create_dir(&new_path).map_err(|e| format!("Could not create folder '{name}': {e}"))?;
    Ok(new_path.to_string_lossy().to_string())
}

pub fn create_file(parent_path: &str, name: &str) -> Result<String, String> {
    validate_name(name)?;
    let new_path = Path::new(parent_path).join(name);
    if new_path.exists() {
        return Err(format!("'{name}' already exists"));
    }
    std::fs::File::create(&new_path).map_err(|e| format!("Could not create file '{name}': {e}"))?;
    Ok(new_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn rename_entry_renames_and_returns_new_path() {
        let dir = tempdir().unwrap();
        let old = dir.path().join("old.txt");
        fs::write(&old, b"hi").unwrap();

        let new_path = rename_entry(old.to_str().unwrap(), "new.txt").unwrap();

        assert!(!old.exists());
        assert_eq!(new_path, dir.path().join("new.txt").to_string_lossy());
        assert!(Path::new(&new_path).exists());
    }

    #[test]
    fn rename_entry_rejects_name_with_path_separator() {
        let dir = tempdir().unwrap();
        let old = dir.path().join("old.txt");
        fs::write(&old, b"hi").unwrap();

        let result = rename_entry(old.to_str().unwrap(), "sub/new.txt");

        assert!(result.is_err());
        assert!(old.exists());
    }

    #[test]
    fn rename_entry_rejects_when_target_exists() {
        let dir = tempdir().unwrap();
        let old = dir.path().join("old.txt");
        let existing = dir.path().join("existing.txt");
        fs::write(&old, b"hi").unwrap();
        fs::write(&existing, b"there").unwrap();

        let result = rename_entry(old.to_str().unwrap(), "existing.txt");

        assert!(result.is_err());
        assert!(old.exists());
    }

    #[test]
    fn create_folder_creates_directory() {
        let dir = tempdir().unwrap();

        let new_path = create_folder(dir.path().to_str().unwrap(), "new_folder").unwrap();

        assert!(Path::new(&new_path).is_dir());
    }

    #[test]
    fn create_folder_rejects_when_already_exists() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("existing")).unwrap();

        let result = create_folder(dir.path().to_str().unwrap(), "existing");

        assert!(result.is_err());
    }

    #[test]
    fn create_file_creates_empty_file() {
        let dir = tempdir().unwrap();

        let new_path = create_file(dir.path().to_str().unwrap(), "new_file.txt").unwrap();

        let metadata = fs::metadata(&new_path).unwrap();
        assert!(metadata.is_file());
        assert_eq!(metadata.len(), 0);
    }

    #[test]
    fn create_file_rejects_invalid_name() {
        let dir = tempdir().unwrap();

        let result = create_file(dir.path().to_str().unwrap(), "..");

        assert!(result.is_err());
    }
}
