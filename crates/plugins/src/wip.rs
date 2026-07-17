use std::path::{Path, PathBuf};

use crate::{list_plugins, plugins_dir, PluginManifest};

/// Repo-relative location of plugins being developed but not yet marketplace-published (see
/// `docs/plugins.md`'s "Local (dev) plugins" section). Resolved via the compile-time crate
/// path, so this only resolves to something real when running a dev build from an actual
/// source checkout -- a packaged release build bakes in the *build machine's* path, which
/// won't exist on an end user's machine. `list_wip_plugins` checks the directory exists before
/// touching it (see below), so that baked-in path is never created or written to at runtime;
/// it just makes the WIP list empty, the same as any other machine without a checkout.
fn default_wip_plugins_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/plugins-wip")
}

pub fn wip_plugins_dir(dir: Option<&Path>) -> PathBuf {
    dir.map(Path::to_path_buf)
        .unwrap_or_else(default_wip_plugins_dir)
}

/// Lists plugins sitting in the WIP folder, in the same `PluginManifest` shape `list_plugins`
/// returns for the real plugins directory. Unlike `list_plugins`, this does **not** create the
/// directory if it's missing -- on a release build (or any machine without a source checkout)
/// the resolved path is meaningless, and creating directories at a path baked in from a
/// different machine would be a real footgun, not just a no-op.
pub fn list_wip_plugins(dir: Option<&Path>) -> Vec<PluginManifest> {
    let wip_dir = wip_plugins_dir(dir);
    if !wip_dir.is_dir() {
        return Vec::new();
    }
    list_plugins(Some(&wip_dir))
}

fn copy_file(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::copy(from, to).map(|_| ()).map_err(|e| {
        format!(
            "Could not copy '{}' to '{}': {e}",
            from.display(),
            to.display()
        )
    })
}

/// Copies a WIP plugin's manifest.json, entry file, and icon.png (if present) into the real
/// plugins directory, overwriting any existing installation there. The local-disk equivalent
/// of installing from the marketplace, but sourced from the WIP folder instead of a network
/// fetch -- and unlike a marketplace install, this also copies the icon, since there's no
/// per-file network round trip to avoid.
pub fn sync_wip_plugin(
    plugin_id: &str,
    wip_dir: Option<&Path>,
    install_dir: Option<&Path>,
) -> Result<(), String> {
    if plugin_id.is_empty()
        || plugin_id.contains(['/', '\\'])
        || plugin_id == "."
        || plugin_id == ".."
    {
        return Err(format!("'{plugin_id}' is not a valid plugin id"));
    }

    let wip_plugins = list_wip_plugins(wip_dir);
    let manifest = wip_plugins
        .iter()
        .find(|m| m.id == plugin_id)
        .ok_or_else(|| format!("No WIP plugin found with id '{plugin_id}'"))?;

    let source_dir = Path::new(&manifest.dir);
    let dest_dir = plugins_dir(install_dir).join(plugin_id);
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Could not create '{}': {e}", dest_dir.display()))?;

    copy_file(
        &source_dir.join("manifest.json"),
        &dest_dir.join("manifest.json"),
    )?;

    let entry_dest = dest_dir.join(&manifest.entry);
    if let Some(parent) = entry_dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create '{}': {e}", parent.display()))?;
    }
    copy_file(&source_dir.join(&manifest.entry), &entry_dest)?;

    if manifest.has_icon {
        copy_file(&source_dir.join("icon.png"), &dest_dir.join("icon.png"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_wip_plugin(root: &Path, id: &str, entry_relative: &str, with_icon: bool) {
        let plugin_dir = root.join(id);
        fs::create_dir_all(&plugin_dir).unwrap();
        fs::write(
            plugin_dir.join("manifest.json"),
            format!(
                r#"{{"id":"{id}","name":"{id}","version":"1.0.0","author":"Me","entry":"{entry_relative}"}}"#
            ),
        )
        .unwrap();
        let entry_path = plugin_dir.join(entry_relative);
        if let Some(parent) = entry_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(entry_path, "// wip plugin code").unwrap();
        if with_icon {
            fs::write(plugin_dir.join("icon.png"), b"not a real png").unwrap();
        }
    }

    #[test]
    fn list_wip_plugins_returns_empty_when_the_directory_does_not_exist() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");

        let plugins = list_wip_plugins(Some(&missing));

        assert!(plugins.is_empty());
        assert!(!missing.exists(), "must not create the WIP directory");
    }

    #[test]
    fn list_wip_plugins_finds_a_plugin() {
        let dir = tempdir().unwrap();
        write_wip_plugin(dir.path(), "in-progress", "frontend/index.js", false);

        let plugins = list_wip_plugins(Some(dir.path()));

        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].id, "in-progress");
    }

    #[test]
    fn sync_wip_plugin_copies_manifest_and_entry() {
        let wip = tempdir().unwrap();
        let install = tempdir().unwrap();
        write_wip_plugin(wip.path(), "my-plugin", "frontend/index.js", false);

        sync_wip_plugin("my-plugin", Some(wip.path()), Some(install.path())).unwrap();

        assert!(install
            .path()
            .join("my-plugin")
            .join("manifest.json")
            .is_file());
        assert_eq!(
            fs::read_to_string(install.path().join("my-plugin").join("frontend/index.js")).unwrap(),
            "// wip plugin code"
        );
    }

    #[test]
    fn sync_wip_plugin_copies_the_icon_when_present() {
        let wip = tempdir().unwrap();
        let install = tempdir().unwrap();
        write_wip_plugin(wip.path(), "with-icon", "index.js", true);

        sync_wip_plugin("with-icon", Some(wip.path()), Some(install.path())).unwrap();

        assert!(install.path().join("with-icon").join("icon.png").is_file());
    }

    #[test]
    fn sync_wip_plugin_overwrites_an_existing_installation() {
        let wip = tempdir().unwrap();
        let install = tempdir().unwrap();
        write_wip_plugin(wip.path(), "my-plugin", "index.js", false);

        let dest = install.path().join("my-plugin");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("manifest.json"), "stale").unwrap();

        sync_wip_plugin("my-plugin", Some(wip.path()), Some(install.path())).unwrap();

        assert_ne!(
            fs::read_to_string(dest.join("manifest.json")).unwrap(),
            "stale"
        );
    }

    #[test]
    fn sync_wip_plugin_errors_for_an_unknown_id() {
        let wip = tempdir().unwrap();
        let install = tempdir().unwrap();

        let result = sync_wip_plugin("does-not-exist", Some(wip.path()), Some(install.path()));

        assert!(result.is_err());
    }

    #[test]
    fn sync_wip_plugin_rejects_a_plugin_id_containing_a_path_separator() {
        let wip = tempdir().unwrap();
        let install = tempdir().unwrap();

        let result = sync_wip_plugin("../escape", Some(wip.path()), Some(install.path()));

        assert!(result.is_err());
    }
}
