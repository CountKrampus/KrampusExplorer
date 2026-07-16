import { convertFileSrc } from "@tauri-apps/api/core";
import { usePluginStore } from "../stores/usePluginStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import "./IconRail.css";

export function panelKey(pluginId: string, panelId: string): string {
  return `${pluginId}:${panelId}`;
}

/** A narrow icon strip, one button per plugin sidebar panel — clicking one shows only that
 * plugin's panel in the content area below Favorites/Drives, instead of every installed plugin's
 * panel being permanently expanded and stacked (unworkable once there are more than two or three
 * plugins installed; see docs/plugins.md). Clicking the already-active icon deselects it. */
function IconRail() {
  const panels = usePluginStore((state) => state.panels);
  const manifests = usePluginStore((state) => state.manifests);
  const active = useSettingsStore((state) => state.activePluginPanel);
  const setActive = useSettingsStore((state) => state.setActivePluginPanel);

  if (panels.length === 0) return null;

  return (
    <nav className="icon-rail" aria-label="Plugin panels">
      {panels.map((panel) => {
        const manifest = manifests.find((m) => m.id === panel.pluginId);
        const key = panelKey(panel.pluginId, panel.id);
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            className={`icon-rail__button ${isActive ? "icon-rail__button--active" : ""}`}
            aria-label={panel.title}
            aria-pressed={isActive}
            title={panel.title}
            onClick={() => setActive(isActive ? null : key)}
          >
            {manifest?.hasIcon ? (
              <img className="icon-rail__icon" src={convertFileSrc(`${manifest.dir}/icon.png`)} alt="" />
            ) : (
              <span className="icon-rail__icon icon-rail__icon--placeholder">
                {panel.title.charAt(0).toUpperCase()}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export default IconRail;
