//! Config, themes, and user preferences.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// "light" | "dark" | "system"
    pub theme: String,
    pub accent_color: String,
    /// "home" | "custom" | "last" — where the first tab opens on launch.
    pub startup_mode: String,
    pub startup_custom_path: Option<String>,
    /// "small" | "medium" | "large"
    pub icon_size: String,
    /// Most recently navigated-to folder, updated on every navigation. Used when
    /// `startup_mode` is "last"; kept even when a different startup mode is active, so
    /// switching back to "last" doesn't start from nothing.
    ///
    /// `#[serde(default)]` matters here beyond the missing-file case: without it, loading a
    /// settings.json written before this field existed would fail deserialization entirely
    /// and silently reset every other setting to defaults too (load_settings falls back to
    /// `Settings::default()` on ANY parse error, not just per-field).
    #[serde(default)]
    pub last_location: Option<String>,
    /// IDs of plugins the user has turned off. A disabled plugin's manifest is still listed
    /// (so it can be re-enabled), but its entry script is never executed.
    #[serde(default)]
    pub disabled_plugins: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            accent_color: "#2b6cb0".to_string(),
            startup_mode: "home".to_string(),
            startup_custom_path: None,
            icon_size: "medium".to_string(),
            last_location: None,
            disabled_plugins: Vec::new(),
        }
    }
}

fn default_settings_path() -> PathBuf {
    let mut dir = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    dir.push("Krampus Explorer");
    let _ = std::fs::create_dir_all(&dir);
    dir.push("settings.json");
    dir
}

/// Loads settings from disk, falling back to defaults if the file is missing, unreadable, or
/// corrupted — a broken settings file should never prevent the app from starting.
pub fn load_settings(path: Option<&Path>) -> Settings {
    let path = path
        .map(Path::to_path_buf)
        .unwrap_or_else(default_settings_path);
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Settings::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

pub fn save_settings(settings: &Settings, path: Option<&Path>) -> Result<(), String> {
    let path = path
        .map(Path::to_path_buf)
        .unwrap_or_else(default_settings_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create settings directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Could not serialize settings: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Could not write settings: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn load_settings_returns_defaults_when_file_missing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("does-not-exist.json");

        let settings = load_settings(Some(&path));

        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = Settings {
            theme: "dark".to_string(),
            accent_color: "#ff0000".to_string(),
            startup_mode: "custom".to_string(),
            startup_custom_path: Some("C:\\Projects".to_string()),
            icon_size: "large".to_string(),
            last_location: Some("C:\\Users\\boo\\Documents".to_string()),
            disabled_plugins: vec!["quick-notes".to_string()],
        };

        save_settings(&settings, Some(&path)).unwrap();
        let loaded = load_settings(Some(&path));

        assert_eq!(loaded, settings);
    }

    #[test]
    fn load_settings_fills_in_missing_last_location_without_resetting_everything_else() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // Simulates a settings.json written before `last_location` existed.
        std::fs::write(
            &path,
            r##"{"theme":"dark","accentColor":"#ff0000","startupMode":"custom","startupCustomPath":"C:\\Projects","iconSize":"large"}"##,
        )
        .unwrap();

        let settings = load_settings(Some(&path));

        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.startup_mode, "custom");
        assert_eq!(settings.last_location, None);
    }

    #[test]
    fn load_settings_fills_in_missing_disabled_plugins_without_resetting_everything_else() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // Simulates a settings.json written before `disabled_plugins` existed.
        std::fs::write(
            &path,
            r##"{"theme":"dark","accentColor":"#ff0000","startupMode":"custom","startupCustomPath":"C:\\Projects","iconSize":"large"}"##,
        )
        .unwrap();

        let settings = load_settings(Some(&path));

        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.disabled_plugins, Vec::<String>::new());
    }

    #[test]
    fn load_settings_falls_back_to_defaults_on_corrupted_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "not valid json").unwrap();

        let settings = load_settings(Some(&path));

        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn save_settings_creates_missing_parent_directories() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested").join("dir").join("settings.json");

        save_settings(&Settings::default(), Some(&path)).unwrap();

        assert!(path.exists());
    }
}
