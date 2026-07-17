import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePluginStore } from "../stores/usePluginStore";
import type { PluginManifest } from "../types/plugin";
import "./WipPlugins.css";

// Plugins not yet published to the marketplace live in examples/plugins-wip/ (see
// docs/plugins.md's "Local (dev) plugins" section). This list only resolves to anything on a
// dev build running from a real source checkout -- a released app has nowhere on disk for
// that folder to exist, so list_wip_plugins just returns empty there, same as if you'd never
// created any WIP plugins at all.
export function formatMeta(plugin: PluginManifest): string {
  const base = `v${plugin.version} by ${plugin.author}`;
  return plugin.permissions.length > 0 ? `${base} — ${plugin.permissions.join(", ")}` : base;
}

function WipPlugins() {
  const loadPlugins = usePluginStore((state) => state.loadPlugins);

  const [entries, setEntries] = useState<PluginManifest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedId, setLastSyncedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<PluginManifest[]>("list_wip_plugins")
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

  async function sync(plugin: PluginManifest) {
    setSyncingId(plugin.id);
    setSyncError(null);
    try {
      await invoke("sync_wip_plugin", { pluginId: plugin.id });
      // Re-scans the plugins directory and re-runs every enabled plugin's entry script fresh,
      // same as a marketplace install -- no app restart needed to pick up the synced files.
      await loadPlugins();
      setLastSyncedId(plugin.id);
    } catch (error) {
      setSyncError(`${plugin.name}: ${String(error)}`);
    } finally {
      setSyncingId(null);
    }
  }

  if (loadError) {
    return <p className="wip-plugins__empty wip-plugins__empty--error">{loadError}</p>;
  }
  if (!entries) {
    return <p className="wip-plugins__empty">Loading local plugins…</p>;
  }

  return (
    <div className="wip-plugins">
      {syncError && <p className="wip-plugins__empty wip-plugins__empty--error">{syncError}</p>}
      {entries.length === 0 ? (
        <p className="wip-plugins__empty">
          No plugins found in examples/plugins-wip/. Drop an in-progress plugin folder there to
          sync it into your plugins directory without pushing or restarting.
        </p>
      ) : (
        <ul className="wip-plugins__list">
          {entries.map((plugin) => (
            <li key={plugin.id}>
              <div className="wip-plugins__info">
                <span className="wip-plugins__name">{plugin.name}</span>
                <span className="wip-plugins__meta">{formatMeta(plugin)}</span>
              </div>
              <button
                type="button"
                disabled={syncingId === plugin.id}
                onClick={() => void sync(plugin)}
              >
                {syncingId === plugin.id
                  ? "Syncing…"
                  : lastSyncedId === plugin.id
                    ? "Synced ✓ — Sync again"
                    : "Sync"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default WipPlugins;
