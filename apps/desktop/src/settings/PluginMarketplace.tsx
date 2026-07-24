import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { usePluginStore } from "../stores/usePluginStore";
import "./PluginMarketplace.css";

// Always resolves against `master` — the marketplace intentionally always reflects the latest
// plugin set in the repo, not whatever tag the running app happened to build from. A plugin
// listed here may require backend capabilities newer than the installed app version; that's the
// same core-app-vs-plugin gap documented in docs/releasing.md, not something this UI can detect.
const MARKETPLACE_URL =
  "https://raw.githubusercontent.com/CountKrampus/KrampusExplorer/master/marketplace.json";
const PLUGIN_BASE_URL =
  "https://raw.githubusercontent.com/CountKrampus/KrampusExplorer/master/examples/plugins";

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
}

interface FetchedManifest {
  entry?: string;
}

/** Converts a binary `ArrayBuffer` (e.g. a fetched `icon.png`) to a base64 string for the
 * `install_plugin` command, which decodes it back to raw bytes on the Rust side -- `content` on
 * `PluginFile` is a JSON string, so binary data can't cross that boundary any other way. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** installedIds comes from the plugins directory scan (usePluginStore.manifests), not the
 * marketplace itself — a plugin is "installed" when its id shows up there. */
export function isInstalled(entryId: string, installedIds: string[]): boolean {
  return installedIds.includes(entryId);
}

function PluginMarketplace() {
  // useShallow (not a plain selector) — `.map()` returns a brand-new array on every call, and
  // zustand's default equality is Object.is on the whole returned value, so an unwrapped selector
  // here would never compare equal to its own previous result and would render forever (the same
  // "Maximum update depth exceeded" crash TabBar had). useShallow's element-wise comparison
  // works here because the elements are plain strings, unlike TabBar's case.
  const installedIds = usePluginStore(
    useShallow((state) => state.manifests.map((manifest) => manifest.id)),
  );
  const loadPlugins = usePluginStore((state) => state.loadPlugins);

  const [entries, setEntries] = useState<MarketplaceEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(MARKETPLACE_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Marketplace fetch failed (${response.status})`);
        return response.json() as Promise<MarketplaceEntry[]>;
      })
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function install(entry: MarketplaceEntry) {
    setInstallingId(entry.id);
    setInstallError(null);
    try {
      const base = `${PLUGIN_BASE_URL}/${entry.id}`;

      const manifestResponse = await fetch(`${base}/manifest.json`);
      if (!manifestResponse.ok) {
        throw new Error(`Could not fetch manifest.json (${manifestResponse.status})`);
      }
      const manifestText = await manifestResponse.text();
      const manifest = JSON.parse(manifestText) as FetchedManifest;
      if (!manifest.entry) {
        throw new Error('manifest.json is missing an "entry" field');
      }

      const entryResponse = await fetch(`${base}/${manifest.entry}`);
      if (!entryResponse.ok) {
        throw new Error(`Could not fetch ${manifest.entry} (${entryResponse.status})`);
      }
      const entryText = await entryResponse.text();

      const files = [
        { relativePath: "manifest.json", content: manifestText, isBase64: false },
        { relativePath: manifest.entry, content: entryText, isBase64: false },
      ];

      // icon.png is optional -- most plugins have one, but not all. A 404 here just means this
      // plugin has no icon; the app already falls back to a letter-avatar placeholder for that
      // case, so it's not an install failure.
      const iconResponse = await fetch(`${base}/icon.png`);
      if (iconResponse.ok) {
        const iconBuffer = await iconResponse.arrayBuffer();
        const iconBase64 = arrayBufferToBase64(iconBuffer);
        files.push({ relativePath: "icon.png", content: iconBase64, isBase64: true });
      }

      await invoke("install_plugin", { pluginId: entry.id, files });

      // Re-scans the plugins directory and re-runs every enabled plugin's entry script fresh —
      // the newly-installed plugin shows up with no app restart needed, same as toggling a
      // plugin on/off in the list above.
      await loadPlugins();
    } catch (error) {
      setInstallError(`${entry.name}: ${String(error)}`);
    } finally {
      setInstallingId(null);
    }
  }

  if (loadError) {
    return <p className="plugin-marketplace__empty plugin-marketplace__empty--error">{loadError}</p>;
  }
  if (!entries) {
    return <p className="plugin-marketplace__empty">Loading marketplace…</p>;
  }

  return (
    <div className="plugin-marketplace">
      {installError && (
        <p className="plugin-marketplace__empty plugin-marketplace__empty--error">{installError}</p>
      )}
      {entries.length === 0 ? (
        <p className="plugin-marketplace__empty">No plugins are listed in the marketplace yet.</p>
      ) : (
        <ul className="plugin-marketplace__list">
          {entries.map((entry) => {
            const installed = isInstalled(entry.id, installedIds);
            return (
              <li key={entry.id}>
                <div className="plugin-marketplace__info">
                  <span className="plugin-marketplace__name">{entry.name}</span>
                  <span className="plugin-marketplace__description">{entry.description}</span>
                </div>
                {installed ? (
                  <span className="plugin-marketplace__badge plugin-marketplace__badge--installed">
                    Installed
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={installingId === entry.id}
                    onClick={() => void install(entry)}
                  >
                    {installingId === entry.id ? "Installing…" : "Install"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default PluginMarketplace;
