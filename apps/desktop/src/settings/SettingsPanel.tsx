import { useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSettingsStore, type IconSize, type StartupMode, type Theme } from "../stores/useSettingsStore";
import { usePluginStore } from "../stores/usePluginStore";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "./SettingsPanel.css";

const SHORTCUTS: [string, string][] = [
  ["F2", "Rename selected item"],
  ["Delete", "Move selected item to Recycle Bin"],
  ["Ctrl+C", "Copy selected item"],
  ["Ctrl+X", "Cut selected item"],
  ["Ctrl+V", "Paste"],
  ["Ctrl+drag", "Copy instead of move when dropping"],
];

// A separate component that only mounts while the panel is open, so useFocusTrap's mount effect
// (auto-focus, restore focus on unmount) fires fresh on every open — not just once ever, which is
// what happens if this logic lives in SettingsPanel itself and merely renders `null` while closed
// (the container stays mounted, so the ref's identity never changes between opens).
function SettingsPanelBody() {
  const setOpen = useSettingsStore((state) => state.setPanelOpen);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const setAccentColor = useSettingsStore((state) => state.setAccentColor);
  const startupMode = useSettingsStore((state) => state.startupMode);
  const setStartupMode = useSettingsStore((state) => state.setStartupMode);
  const startupCustomPath = useSettingsStore((state) => state.startupCustomPath);
  const setStartupCustomPath = useSettingsStore((state) => state.setStartupCustomPath);
  const iconSize = useSettingsStore((state) => state.iconSize);
  const setIconSize = useSettingsStore((state) => state.setIconSize);
  const disabledPlugins = useSettingsStore((state) => state.disabledPlugins);
  const setPluginEnabled = useSettingsStore((state) => state.setPluginEnabled);
  const pluginManifests = usePluginStore((state) => state.manifests);
  const pluginErrors = usePluginStore((state) => state.errors);
  const loadPlugins = usePluginStore((state) => state.loadPlugins);

  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, () => setOpen(false));

  return (
    <div className="settings-panel-backdrop" onClick={() => setOpen(false)}>
      <div
        className="settings-panel"
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-panel__header">
          <h2>Settings</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close settings"
            title="Close settings"
          >
            &#x2715;
          </button>
        </div>

        <section className="settings-panel__section">
          <h3>Theme</h3>
          <div className="settings-panel__options">
            {(["light", "dark", "system"] as Theme[]).map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="theme"
                  checked={theme === option}
                  onChange={() => setTheme(option)}
                />
                {option[0].toUpperCase() + option.slice(1)}
              </label>
            ))}
          </div>
        </section>

        <section className="settings-panel__section">
          <h3>Accent color</h3>
          <input
            type="color"
            value={accentColor}
            onChange={(event) => setAccentColor(event.target.value)}
          />
        </section>

        <section className="settings-panel__section">
          <h3>Startup folder</h3>
          <div className="settings-panel__options">
            {(["home", "last", "custom"] as StartupMode[]).map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="startupMode"
                  checked={startupMode === option}
                  onChange={() => setStartupMode(option)}
                />
                {option === "home" ? "Home folder" : option === "last" ? "Last opened folder" : "Custom folder"}
              </label>
            ))}
          </div>
          {startupMode === "custom" && (
            <input
              type="text"
              className="settings-panel__text-input"
              placeholder="C:\\Path\\To\\Folder"
              value={startupCustomPath ?? ""}
              onChange={(event) => setStartupCustomPath(event.target.value || null)}
            />
          )}
        </section>

        <section className="settings-panel__section">
          <h3>Icon size</h3>
          <div className="settings-panel__options">
            {(["small", "medium", "large"] as IconSize[]).map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="iconSize"
                  checked={iconSize === option}
                  onChange={() => setIconSize(option)}
                />
                {option[0].toUpperCase() + option.slice(1)}
              </label>
            ))}
          </div>
        </section>

        <section className="settings-panel__section">
          <h3>Plugins</h3>
          {pluginManifests.length === 0 ? (
            <p className="settings-panel__empty">
              No plugins installed. Drop a plugin folder (with a manifest.json) into your plugins
              directory and restart the app.
            </p>
          ) : (
            <ul className="settings-panel__plugin-list">
              {pluginManifests.map((plugin) => {
                const enabled = !disabledPlugins.includes(plugin.id);
                return (
                  <li key={plugin.id}>
                    {plugin.hasIcon ? (
                      <img
                        className="settings-panel__plugin-icon"
                        src={convertFileSrc(`${plugin.dir}/icon.png`)}
                        alt=""
                      />
                    ) : (
                      <span className="settings-panel__plugin-icon settings-panel__plugin-icon--placeholder" />
                    )}
                    <div className="settings-panel__plugin-info">
                      <span className="settings-panel__plugin-name">{plugin.name}</span>
                      <span className="settings-panel__plugin-meta">
                        v{plugin.version} by {plugin.author}
                        {plugin.permissions.length > 0 && ` — ${plugin.permissions.join(", ")}`}
                      </span>
                    </div>
                    <label className="settings-panel__plugin-toggle">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => {
                          setPluginEnabled(plugin.id, !enabled);
                          void loadPlugins();
                        }}
                      />
                      Enabled
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {pluginErrors.length > 0 && (
            <ul className="settings-panel__plugin-errors">
              {pluginErrors.map((error) => (
                <li key={error.pluginId}>
                  {error.pluginId}: {error.message}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="settings-panel__section">
          <h3>Keyboard shortcuts</h3>
          <table className="settings-panel__shortcuts">
            <tbody>
              {SHORTCUTS.map(([keys, description]) => (
                <tr key={keys}>
                  <td className="settings-panel__keys">{keys}</td>
                  <td>{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const open = useSettingsStore((state) => state.panelOpen);

  if (!open) return null;

  return <SettingsPanelBody />;
}

export default SettingsPanel;
