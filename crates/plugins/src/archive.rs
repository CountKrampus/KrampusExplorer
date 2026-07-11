use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

/// Zips `source_paths` (files and/or directories, recursively) into a new archive at
/// `dest_zip_path`. Returns `dest_zip_path`.
pub fn create_zip_archive(source_paths: &[String], dest_zip_path: &str) -> Result<String, String> {
    let file = File::create(dest_zip_path).map_err(|e| format!("Could not create archive: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default();

    for source in source_paths {
        let path = Path::new(source);
        let base_name = path
            .file_name()
            .ok_or_else(|| format!("'{source}' has no file name"))?
            .to_string_lossy()
            .to_string();
        add_to_zip(&mut zip, path, &base_name, options)
            .map_err(|e| format!("Could not add '{source}' to archive: {e}"))?;
    }

    zip.finish()
        .map_err(|e| format!("Could not finalize archive: {e}"))?;
    Ok(dest_zip_path.to_string())
}

fn add_to_zip(
    zip: &mut ZipWriter<File>,
    path: &Path,
    zip_path: &str,
    options: SimpleFileOptions,
) -> zip::result::ZipResult<()> {
    if path.is_dir() {
        zip.add_directory(format!("{zip_path}/"), options)?;
        for entry in std::fs::read_dir(path)?.flatten() {
            let child_zip_path = format!("{zip_path}/{}", entry.file_name().to_string_lossy());
            add_to_zip(zip, &entry.path(), &child_zip_path, options)?;
        }
    } else {
        zip.start_file(zip_path, options)?;
        let mut buffer = Vec::new();
        File::open(path)?.read_to_end(&mut buffer)?;
        zip.write_all(&buffer)?;
    }
    Ok(())
}

/// Extracts `zip_path` into `dest_dir` (created if missing). Returns `dest_dir`. Entries whose
/// path would escape `dest_dir` (a "zip slip" attempt, e.g. via `../`) are skipped rather than
/// followed — `enclosed_name()` is the `zip` crate's own guard against this.
pub fn extract_zip_archive(zip_path: &str, dest_dir: &str) -> Result<String, String> {
    let file = File::open(zip_path).map_err(|e| format!("Could not open archive: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Could not read archive: {e}"))?;
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("Could not create destination: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Could not read archive entry: {e}"))?;
        let out_path = match entry.enclosed_name() {
            Some(name) => Path::new(dest_dir).join(name),
            None => continue,
        };

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("Could not create '{}': {e}", out_path.display()))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Could not create '{}': {e}", parent.display()))?;
            }
            let mut out_file = File::create(&out_path)
                .map_err(|e| format!("Could not create '{}': {e}", out_path.display()))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("Could not extract '{}': {e}", out_path.display()))?;
        }
    }
    Ok(dest_dir.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn round_trips_a_single_file() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("a.txt");
        fs::write(&source, b"hello").unwrap();
        let zip_path = dir.path().join("out.zip");

        create_zip_archive(
            &[source.to_string_lossy().to_string()],
            zip_path.to_str().unwrap(),
        )
        .unwrap();

        let extract_dir = dir.path().join("extracted");
        extract_zip_archive(zip_path.to_str().unwrap(), extract_dir.to_str().unwrap()).unwrap();

        assert_eq!(fs::read(extract_dir.join("a.txt")).unwrap(), b"hello");
    }

    #[test]
    fn round_trips_a_directory_recursively() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("folder");
        fs::create_dir(&source).unwrap();
        fs::create_dir(source.join("nested")).unwrap();
        fs::write(source.join("top.txt"), b"top").unwrap();
        fs::write(source.join("nested").join("deep.txt"), b"deep").unwrap();
        let zip_path = dir.path().join("out.zip");

        create_zip_archive(
            &[source.to_string_lossy().to_string()],
            zip_path.to_str().unwrap(),
        )
        .unwrap();

        let extract_dir = dir.path().join("extracted");
        extract_zip_archive(zip_path.to_str().unwrap(), extract_dir.to_str().unwrap()).unwrap();

        assert_eq!(
            fs::read(extract_dir.join("folder").join("top.txt")).unwrap(),
            b"top"
        );
        assert_eq!(
            fs::read(extract_dir.join("folder").join("nested").join("deep.txt")).unwrap(),
            b"deep"
        );
    }

    #[test]
    fn archives_multiple_sources_into_one_zip() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a.txt");
        let b = dir.path().join("b.txt");
        fs::write(&a, b"aaa").unwrap();
        fs::write(&b, b"bbb").unwrap();
        let zip_path = dir.path().join("out.zip");

        create_zip_archive(
            &[
                a.to_string_lossy().to_string(),
                b.to_string_lossy().to_string(),
            ],
            zip_path.to_str().unwrap(),
        )
        .unwrap();

        let extract_dir = dir.path().join("extracted");
        extract_zip_archive(zip_path.to_str().unwrap(), extract_dir.to_str().unwrap()).unwrap();

        assert_eq!(fs::read(extract_dir.join("a.txt")).unwrap(), b"aaa");
        assert_eq!(fs::read(extract_dir.join("b.txt")).unwrap(), b"bbb");
    }

    #[test]
    fn create_zip_archive_errors_on_missing_source() {
        let dir = tempdir().unwrap();
        let zip_path = dir.path().join("out.zip");

        let result = create_zip_archive(
            &[dir
                .path()
                .join("does-not-exist.txt")
                .to_string_lossy()
                .to_string()],
            zip_path.to_str().unwrap(),
        );

        assert!(result.is_err());
    }

    #[test]
    fn extract_zip_archive_errors_on_invalid_zip() {
        let dir = tempdir().unwrap();
        let not_a_zip = dir.path().join("not-a-zip.zip");
        fs::write(&not_a_zip, b"not a real zip file").unwrap();

        let result = extract_zip_archive(
            not_a_zip.to_str().unwrap(),
            dir.path().join("out").to_str().unwrap(),
        );

        assert!(result.is_err());
    }
}
