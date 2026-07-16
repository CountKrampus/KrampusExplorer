//! Plugin loading, permissions, lifecycle, and the plugin API.

mod archive;
mod database;
mod exec;
mod git;
mod install;
mod mongo;
mod scan;

pub use archive::{create_zip_archive, extract_zip_archive};
pub use database::{list_sqlite_tables, query_sqlite_table, TableData};
pub use exec::{run_command, CommandOutput};
pub use git::{git_log, git_status, GitCommit, GitFileStatus};
pub use install::{install_plugin, PluginFile};
pub use mongo::{list_mongo_collections, list_mongo_databases, query_mongo_collection};
pub use scan::{hash_file_all, hash_files, scan_directory, FileHash, MultiHash, ScannedFile};

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    /// Path to the plugin's JS entry file, relative to the plugin's own directory.
    pub entry: String,
    /// Absolute path to the plugin's directory. Not part of manifest.json itself — filled in
    /// after parsing so the frontend can resolve `entry` without knowing the plugins root.
    #[serde(default)]
    pub dir: String,
    /// Whether an `icon.png` file exists in the plugin's directory. Not part of manifest.json
    /// itself — icons follow a fixed-filename convention rather than being declared, so this is
    /// just an existence check filled in alongside `dir`. The frontend resolves the actual path
    /// as `{dir}/icon.png` via the asset protocol when this is true.
    #[serde(default)]
    pub has_icon: bool,
}

fn default_plugins_dir() -> PathBuf {
    let mut dir = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    dir.push("Krampus Explorer");
    dir.push("plugins");
    dir
}

pub fn plugins_dir(dir: Option<&Path>) -> PathBuf {
    dir.map(Path::to_path_buf)
        .unwrap_or_else(default_plugins_dir)
}

fn is_valid(manifest: &PluginManifest) -> bool {
    !manifest.id.is_empty()
        && !manifest.name.is_empty()
        && !manifest.version.is_empty()
        && !manifest.author.is_empty()
        && !manifest.entry.is_empty()
}

/// Scans immediate subdirectories of the plugins directory for a `manifest.json` each.
/// Creates the plugins directory if it doesn't exist yet (so there's somewhere to drop
/// plugins into). Invalid or unreadable manifests, and manifests whose `entry` file doesn't
/// exist, are silently skipped rather than failing the whole scan.
pub fn list_plugins(dir: Option<&Path>) -> Vec<PluginManifest> {
    let dir = plugins_dir(dir);
    let _ = std::fs::create_dir_all(&dir);

    let Ok(read_dir) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut manifests = Vec::new();
    for entry in read_dir.flatten() {
        let plugin_dir = entry.path();
        if !plugin_dir.is_dir() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(plugin_dir.join("manifest.json")) else {
            continue;
        };
        let Ok(mut manifest) = serde_json::from_str::<PluginManifest>(&content) else {
            continue;
        };
        if !is_valid(&manifest) || !plugin_dir.join(&manifest.entry).is_file() {
            continue;
        }
        manifest.dir = plugin_dir.to_string_lossy().to_string();
        manifest.has_icon = plugin_dir.join("icon.png").is_file();
        manifests.push(manifest);
    }
    manifests
}

pub fn read_entry(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("Could not read plugin entry '{path}': {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_plugin(root: &Path, id: &str, manifest_json: &str, entry_relative: Option<&str>) {
        let plugin_dir = root.join(id);
        fs::create_dir_all(&plugin_dir).unwrap();
        fs::write(plugin_dir.join("manifest.json"), manifest_json).unwrap();
        if let Some(entry) = entry_relative {
            let entry_path = plugin_dir.join(entry);
            if let Some(parent) = entry_path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(entry_path, "// plugin code").unwrap();
        }
    }

    #[test]
    fn list_plugins_finds_a_valid_plugin() {
        let dir = tempdir().unwrap();
        write_plugin(
            dir.path(),
            "hello",
            r#"{"id":"hello","name":"Hello","version":"1.0.0","author":"Me","permissions":["ui.sidebar"],"entry":"frontend/index.js"}"#,
            Some("frontend/index.js"),
        );

        let plugins = list_plugins(Some(dir.path()));

        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].id, "hello");
        assert_eq!(plugins[0].permissions, vec!["ui.sidebar".to_string()]);
        assert_eq!(plugins[0].dir, dir.path().join("hello").to_string_lossy());
    }

    #[test]
    fn list_plugins_skips_manifest_with_missing_entry_file() {
        let dir = tempdir().unwrap();
        write_plugin(
            dir.path(),
            "broken",
            r#"{"id":"broken","name":"Broken","version":"1.0.0","author":"Me","entry":"frontend/index.js"}"#,
            None, // entry file never created
        );

        let plugins = list_plugins(Some(dir.path()));

        assert!(plugins.is_empty());
    }

    #[test]
    fn list_plugins_skips_invalid_json() {
        let dir = tempdir().unwrap();
        write_plugin(dir.path(), "malformed", "not valid json", Some("index.js"));

        let plugins = list_plugins(Some(dir.path()));

        assert!(plugins.is_empty());
    }

    #[test]
    fn list_plugins_skips_manifest_missing_required_fields() {
        let dir = tempdir().unwrap();
        write_plugin(
            dir.path(),
            "incomplete",
            r#"{"id":"","name":"No ID","version":"1.0.0","author":"Me","entry":"index.js"}"#,
            Some("index.js"),
        );

        let plugins = list_plugins(Some(dir.path()));

        assert!(plugins.is_empty());
    }

    #[test]
    fn list_plugins_creates_the_directory_if_missing() {
        let dir = tempdir().unwrap();
        let plugins_root = dir.path().join("does-not-exist-yet");

        let plugins = list_plugins(Some(&plugins_root));

        assert!(plugins.is_empty());
        assert!(plugins_root.is_dir());
    }

    #[test]
    fn list_plugins_permissions_default_to_empty_when_omitted() {
        let dir = tempdir().unwrap();
        write_plugin(
            dir.path(),
            "no-perms",
            r#"{"id":"no-perms","name":"No Perms","version":"1.0.0","author":"Me","entry":"index.js"}"#,
            Some("index.js"),
        );

        let plugins = list_plugins(Some(dir.path()));

        assert_eq!(plugins.len(), 1);
        assert!(plugins[0].permissions.is_empty());
    }

    #[test]
    fn list_plugins_detects_an_icon_png_when_present() {
        let dir = tempdir().unwrap();
        write_plugin(
            dir.path(),
            "with-icon",
            r#"{"id":"with-icon","name":"With Icon","version":"1.0.0","author":"Me","entry":"index.js"}"#,
            Some("index.js"),
        );
        fs::write(
            dir.path().join("with-icon").join("icon.png"),
            b"not a real png",
        )
        .unwrap();

        let plugins = list_plugins(Some(dir.path()));

        assert_eq!(plugins.len(), 1);
        assert!(plugins[0].has_icon);
    }

    #[test]
    fn list_plugins_has_icon_false_when_icon_png_missing() {
        let dir = tempdir().unwrap();
        write_plugin(
            dir.path(),
            "no-icon",
            r#"{"id":"no-icon","name":"No Icon","version":"1.0.0","author":"Me","entry":"index.js"}"#,
            Some("index.js"),
        );

        let plugins = list_plugins(Some(dir.path()));

        assert_eq!(plugins.len(), 1);
        assert!(!plugins[0].has_icon);
    }

    #[test]
    fn read_entry_returns_file_contents() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("index.js");
        fs::write(&path, "console.log('hi')").unwrap();

        let content = read_entry(path.to_str().unwrap()).unwrap();

        assert_eq!(content, "console.log('hi')");
    }

    #[test]
    fn read_entry_errors_on_missing_file() {
        let result = read_entry("this-path-should-not-exist-12345.js");

        assert!(result.is_err());
    }
}
