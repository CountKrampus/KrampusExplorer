import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

/** Excludes anything already present locally — installedIds comes from the plugins directory
 * scan (usePluginStore.manifests), not the marketplace itself. */
export function filterUninstalled(
  entries: MarketplaceEntry[],
  installedIds: string[],
): MarketplaceEntry[] {
  const installed = new Set(installedIds);
  return entries.filter((entry) => !installed.has(entry.id));
}

function PluginMarketplace() {
  const installedIds = usePluginStore((state) => state.manifests.map((manifest) => manifest.id));
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

      await invoke("install_plugin", {
        pluginId: entry.id,
        files: [
          { relativePath: "manifest.json", content: manifestText },
          { relativePath: manifest.entry, content: entryText },
        ],
      });

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

  const uninstalled = filterUninstalled(entries, installedIds);

  return (
    <div className="plugin-marketplace">
      {installError && (
        <p className="plugin-marketplace__empty plugin-marketplace__empty--error">{installError}</p>
      )}
      {uninstalled.length === 0 ? (
        <p className="plugin-marketplace__empty">Every marketplace plugin is already installed.</p>
      ) : (
        <ul className="plugin-marketplace__list">
          {uninstalled.map((entry) => (
            <li key={entry.id}>
              <div className="plugin-marketplace__info">
                <span className="plugin-marketplace__name">{entry.name}</span>
                <span className="plugin-marketplace__description">{entry.description}</span>
              </div>
              <button
                type="button"
                disabled={installingId === entry.id}
                onClick={() => void install(entry)}
              >
                {installingId === entry.id ? "Installing…" : "Install"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default PluginMarketplace;
