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

/// Sentinel error string the frontend matches on to trigger its conflict-resolution dialog,
/// rather than showing this as a plain error message.
pub const CONFLICT_ERROR: &str = "EEXIST";

fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    if from.is_dir() {
        std::fs::create_dir_all(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
    } else {
        std::fs::copy(from, to)?;
    }
    Ok(())
}

fn remove_path(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

fn resolve_destination(
    source: &Path,
    dest_dir: &str,
    dest_name: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let name = match dest_name {
        Some(name) => {
            validate_name(name)?;
            name.to_string()
        }
        None => source
            .file_name()
            .ok_or_else(|| format!("'{}' has no file name", source.display()))?
            .to_string_lossy()
            .to_string(),
    };
    Ok(Path::new(dest_dir).join(name))
}

/// Copies `source` (file or directory, recursively) into `dest_dir`, optionally under
/// `dest_name` instead of the source's own name. If the destination already exists and
/// `overwrite` is false, returns `Err(CONFLICT_ERROR)` without touching anything.
pub fn copy_entry(
    source: &str,
    dest_dir: &str,
    dest_name: Option<&str>,
    overwrite: bool,
) -> Result<String, String> {
    let source_path = Path::new(source);
    let dest_path = resolve_destination(source_path, dest_dir, dest_name)?;

    if source_path.is_dir() && dest_path.starts_with(source_path) {
        return Err("Cannot copy a folder into itself".to_string());
    }

    if dest_path.exists() {
        if !overwrite {
            return Err(CONFLICT_ERROR.to_string());
        }
        remove_path(&dest_path).map_err(|e| format!("Could not replace existing item: {e}"))?;
    }

    copy_recursive(source_path, &dest_path)
        .map_err(|e| format!("Could not copy '{source}': {e}"))?;
    Ok(dest_path.to_string_lossy().to_string())
}

/// Moves `source` into `dest_dir`, optionally under `dest_name`. Tries a plain rename first
/// (fast, same-filesystem) and falls back to copy-then-delete-original (e.g. across drives).
/// If the destination already exists and `overwrite` is false, returns `Err(CONFLICT_ERROR)`.
/// Moving an item onto its own current location is a no-op.
pub fn move_entry(
    source: &str,
    dest_dir: &str,
    dest_name: Option<&str>,
    overwrite: bool,
) -> Result<String, String> {
    let source_path = Path::new(source);
    let dest_path = resolve_destination(source_path, dest_dir, dest_name)?;

    if dest_path == source_path {
        return Ok(dest_path.to_string_lossy().to_string());
    }

    if source_path.is_dir() && dest_path.starts_with(source_path) {
        return Err("Cannot move a folder into itself".to_string());
    }

    if dest_path.exists() {
        if !overwrite {
            return Err(CONFLICT_ERROR.to_string());
        }
        remove_path(&dest_path).map_err(|e| format!("Could not replace existing item: {e}"))?;
    }

    if std::fs::rename(source_path, &dest_path).is_err() {
        copy_recursive(source_path, &dest_path)
            .map_err(|e| format!("Could not move '{source}': {e}"))?;
        remove_path(source_path)
            .map_err(|e| format!("Copied but could not remove original '{source}': {e}"))?;
    }
    Ok(dest_path.to_string_lossy().to_string())
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

    #[test]
    fn copy_entry_copies_a_file() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("a.txt");
        fs::write(&source, b"hello").unwrap();
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let new_path = copy_entry(
            source.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            None,
            false,
        )
        .unwrap();

        assert!(source.exists(), "source should still exist after copy");
        assert_eq!(fs::read(&new_path).unwrap(), b"hello");
    }

    #[test]
    fn copy_entry_copies_a_directory_recursively() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("src_dir");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("inner.txt"), b"nested").unwrap();
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let new_path = copy_entry(
            source.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            None,
            false,
        )
        .unwrap();

        assert_eq!(
            fs::read(Path::new(&new_path).join("inner.txt")).unwrap(),
            b"nested"
        );
    }

    #[test]
    fn copy_entry_returns_conflict_sentinel_when_target_exists() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("a.txt");
        fs::write(&source, b"hello").unwrap();
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();
        fs::write(dest_dir.join("a.txt"), b"existing").unwrap();

        let result = copy_entry(
            source.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            None,
            false,
        );

        assert_eq!(result, Err(CONFLICT_ERROR.to_string()));
        assert_eq!(fs::read(dest_dir.join("a.txt")).unwrap(), b"existing");
    }

    #[test]
    fn copy_entry_overwrites_when_requested() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("a.txt");
        fs::write(&source, b"new").unwrap();
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();
        fs::write(dest_dir.join("a.txt"), b"old").unwrap();

        let new_path = copy_entry(
            source.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            None,
            true,
        )
        .unwrap();

        assert_eq!(fs::read(&new_path).unwrap(), b"new");
    }

    #[test]
    fn copy_entry_with_dest_name_uses_that_name() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("a.txt");
        fs::write(&source, b"hello").unwrap();
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let new_path = copy_entry(
            source.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            Some("a (2).txt"),
            false,
        )
        .unwrap();

        assert!(new_path.ends_with("a (2).txt"));
    }

    #[test]
    fn copy_entry_rejects_copying_folder_into_itself() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("folder");
        fs::create_dir(&source).unwrap();
        let nested_dest = source.join("nested");
        fs::create_dir(&nested_dest).unwrap();

        let result = copy_entry(
            source.to_str().unwrap(),
            nested_dest.to_str().unwrap(),
            None,
            false,
        );

        assert!(result.is_err());
    }

    #[test]
    fn move_entry_moves_a_file() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("a.txt");
        fs::write(&source, b"hello").unwrap();
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let new_path = move_entry(
            source.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            None,
            false,
        )
        .unwrap();

        assert!(!source.exists(), "source should be gone after move");
        assert_eq!(fs::read(&new_path).unwrap(), b"hello");
    }

    #[test]
    fn move_entry_onto_own_location_is_a_no_op() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("a.txt");
        fs::write(&source, b"hello").unwrap();

        let new_path = move_entry(
            source.to_str().unwrap(),
            dir.path().to_str().unwrap(),
            None,
            false,
        )
        .unwrap();

        assert_eq!(new_path, source.to_string_lossy());
        assert_eq!(fs::read(&source).unwrap(), b"hello");
    }

    #[test]
    fn move_entry_returns_conflict_sentinel_when_target_exists() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("a.txt");
        fs::write(&source, b"hello").unwrap();
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();
        fs::write(dest_dir.join("a.txt"), b"existing").unwrap();

        let result = move_entry(
            source.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            None,
            false,
        );

        assert_eq!(result, Err(CONFLICT_ERROR.to_string()));
        assert!(source.exists(), "source should be untouched on conflict");
    }
}
