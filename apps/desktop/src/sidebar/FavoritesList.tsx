import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useExplorerStore } from "../stores/useExplorerStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import CollapsibleSection from "./CollapsibleSection";

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function FavoritesList() {
  const [homePath, setHomePath] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const navigateTo = useExplorerStore((state) => state.navigateTo);
  const favoritePaths = useSettingsStore((state) => state.favoritePaths);
  const removeFavorite = useSettingsStore((state) => state.removeFavorite);

  useEffect(() => {
    invoke<string>("get_default_start_path")
      .then((result) => {
        setHomePath(result);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  return (
    <CollapsibleSection sectionId="favorites" title="Favorites">
      {status === "loading" ? (
        <p className="sidebar__message">Loading…</p>
      ) : status === "error" ? (
        <p className="sidebar__message sidebar__message--error">Could not load favorites.</p>
      ) : (
        <ul className="sidebar__list">
          {homePath && (
            <li>
              <button className="sidebar__item" onClick={() => navigateTo(homePath)}>
                Home
              </button>
            </li>
          )}
          {favoritePaths.length === 0 && !homePath ? (
            <li>
              <p className="sidebar__message">
                Right-click a file or folder and choose "Add to Favorites".
              </p>
            </li>
          ) : (
            favoritePaths.map((path) => (
              <li key={path} className="sidebar__favorite-item">
                <button className="sidebar__item sidebar__item--favorite" title={path} onClick={() => navigateTo(path)}>
                  {basename(path)}
                </button>
                <button
                  className="sidebar__favorite-remove"
                  aria-label={`Remove ${basename(path)} from favorites`}
                  title="Remove from favorites"
                  onClick={() => removeFavorite(path)}
                >
                  &#x2715;
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </CollapsibleSection>
  );
}

export default FavoritesList;
