use serde::Deserialize;
use std::path::Path;

use crate::plugins_dir;

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginFile {
    /// Relative to the plugin's own directory, e.g. `"manifest.json"` or `"frontend/index.js"`.
    pub relative_path: String,
    pub content: String,
}

/// Writes `files` into a new (or overwritten) subdirectory of the plugins directory named
/// `plugin_id`, creating parent directories as needed. `plugin_id` and every file's
/// `relative_path` are validated against path traversal — `plugin_id` may not contain a path
/// separator or `..`, and no `relative_path` may be absolute or contain a `..` component. This
/// matters because both come from marketplace content fetched over the network (see
/// `docs/plugins.md`'s marketplace section) rather than from a trusted local source, unlike most
/// other paths this crate handles.
pub fn install_plugin(
    plugin_id: &str,
    files: &[PluginFile],
    dir: Option<&Path>,
) -> Result<(), String> {
    if plugin_id.is_empty()
        || plugin_id.contains(['/', '\\'])
        || plugin_id == "."
        || plugin_id == ".."
    {
        return Err(format!("'{plugin_id}' is not a valid plugin id"));
    }
    if files.is_empty() {
        return Err("No files to install".to_string());
    }

    let root = plugins_dir(dir).join(plugin_id);
    for file in files {
        let relative = Path::new(&file.relative_path);
        if relative.is_absolute()
            || relative
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(format!("Unsafe file path: '{}'", file.relative_path));
        }

        let dest = root.join(relative);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create '{}': {e}", parent.display()))?;
        }
        std::fs::write(&dest, &file.content)
            .map_err(|e| format!("Could not write '{}': {e}", dest.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn writes_every_file_under_the_plugin_id_directory() {
        let dir = tempdir().unwrap();
        let files = vec![
            PluginFile {
                relative_path: "manifest.json".to_string(),
                content: "{}".to_string(),
            },
            PluginFile {
                relative_path: "frontend/index.js".to_string(),
                content: "// hi".to_string(),
            },
        ];

        install_plugin("my-plugin", &files, Some(dir.path())).unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.path().join("my-plugin").join("manifest.json")).unwrap(),
            "{}"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("my-plugin").join("frontend/index.js"))
                .unwrap(),
            "// hi"
        );
    }

    #[test]
    fn rejects_a_plugin_id_containing_a_path_separator() {
        let dir = tempdir().unwrap();
        let files = vec![PluginFile {
            relative_path: "manifest.json".to_string(),
            content: "{}".to_string(),
        }];

        let result = install_plugin("../escape", &files, Some(dir.path()));

        assert!(result.is_err());
    }

    #[test]
    fn rejects_a_relative_path_that_escapes_the_plugin_directory() {
        let dir = tempdir().unwrap();
        let files = vec![PluginFile {
            relative_path: "../../evil.txt".to_string(),
            content: "pwned".to_string(),
        }];

        let result = install_plugin("my-plugin", &files, Some(dir.path()));

        assert!(result.is_err());
    }

    // Absolute-path syntax is platform-specific — `Path::is_absolute()` only recognizes a
    // `C:\...`-style prefix on Windows and a leading `/` on Unix, so this needs one test per
    // platform to actually exercise the check on both the app's real runtime target (Windows)
    // and the CI runner (Linux) rather than silently skipping coverage on one of them.
    #[test]
    #[cfg(windows)]
    fn rejects_an_absolute_relative_path_windows() {
        let dir = tempdir().unwrap();
        let files = vec![PluginFile {
            relative_path: "C:\\Windows\\evil.txt".to_string(),
            content: "pwned".to_string(),
        }];

        let result = install_plugin("my-plugin", &files, Some(dir.path()));

        assert!(result.is_err());
    }

    #[test]
    #[cfg(unix)]
    fn rejects_an_absolute_relative_path_unix() {
        let dir = tempdir().unwrap();
        let files = vec![PluginFile {
            relative_path: "/etc/evil.txt".to_string(),
            content: "pwned".to_string(),
        }];

        let result = install_plugin("my-plugin", &files, Some(dir.path()));

        assert!(result.is_err());
    }

    #[test]
    fn rejects_an_empty_file_list() {
        let dir = tempdir().unwrap();
        let result = install_plugin("my-plugin", &[], Some(dir.path()));
        assert!(result.is_err());
    }

    #[test]
    fn overwrites_an_existing_installation() {
        let dir = tempdir().unwrap();
        let first = vec![PluginFile {
            relative_path: "manifest.json".to_string(),
            content: "old".to_string(),
        }];
        install_plugin("my-plugin", &first, Some(dir.path())).unwrap();

        let second = vec![PluginFile {
            relative_path: "manifest.json".to_string(),
            content: "new".to_string(),
        }];
        install_plugin("my-plugin", &second, Some(dir.path())).unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.path().join("my-plugin").join("manifest.json")).unwrap(),
            "new"
        );
    }
}
