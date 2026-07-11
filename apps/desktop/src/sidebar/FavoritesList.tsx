import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useExplorerStore } from "../stores/useExplorerStore";

function FavoritesList() {
  const [homePath, setHomePath] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const navigateTo = useExplorerStore((state) => state.navigateTo);

  useEffect(() => {
    invoke<string>("get_default_start_path")
      .then((result) => {
        setHomePath(result);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  const favorites = homePath ? [{ label: "Home", path: homePath }] : [];

  return (
    <div className="sidebar__section">
      <div className="sidebar__heading">Favorites</div>
      {status === "loading" ? (
        <p className="sidebar__message">Loading…</p>
      ) : status === "error" ? (
        <p className="sidebar__message sidebar__message--error">Could not load favorites.</p>
      ) : (
        <ul className="sidebar__list">
          {favorites.map((fav) => (
            <li key={fav.path}>
              <button className="sidebar__item" onClick={() => navigateTo(fav.path)}>
                {fav.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default FavoritesList;
