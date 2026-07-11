import { useSettingsStore, type IconSize, type StartupMode, type Theme } from "../stores/useSettingsStore";
import "./SettingsPanel.css";

const SHORTCUTS: [string, string][] = [
  ["F2", "Rename selected item"],
  ["Delete", "Move selected item to Recycle Bin"],
  ["Ctrl+C", "Copy selected item"],
  ["Ctrl+X", "Cut selected item"],
  ["Ctrl+V", "Paste"],
  ["Ctrl+drag", "Copy instead of move when dropping"],
];

function SettingsPanel() {
  const open = useSettingsStore((state) => state.panelOpen);
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

  if (!open) return null;

  return (
    <div className="settings-panel-backdrop" onClick={() => setOpen(false)}>
      <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel__header">
          <h2>Settings</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close settings">
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
            {(["home", "custom"] as StartupMode[]).map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="startupMode"
                  checked={startupMode === option}
                  onChange={() => setStartupMode(option)}
                />
                {option === "home" ? "Home folder" : "Custom folder"}
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

export default SettingsPanel;
