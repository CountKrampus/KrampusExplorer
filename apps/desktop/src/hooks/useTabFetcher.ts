import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useExplorerStore } from "../stores/useExplorerStore";
import type { DirectoryListing } from "../types/filesystem";

export function useTabFetcher() {
  const tabs = useExplorerStore((state) => state.tabs);
  const setTabResult = useExplorerStore((state) => state.setTabResult);
  const inFlight = useRef(new Map<string, string>());

  useEffect(() => {
    for (const tab of tabs) {
      if (!tab.loading) continue;
      const path = tab.history[tab.historyIndex];
      if (inFlight.current.get(tab.id) === path) continue;
      inFlight.current.set(tab.id, path);

      invoke<DirectoryListing>("get_directory_listing", { path })
        .then((listing) => {
          const current = useExplorerStore
            .getState()
            .tabs.find((t) => t.id === tab.id);
          if (!current || current.history[current.historyIndex] !== path) return;
          setTabResult(tab.id, { entries: listing.entries, parent: listing.parent });
        })
        .catch((error: string) => {
          const current = useExplorerStore
            .getState()
            .tabs.find((t) => t.id === tab.id);
          if (!current || current.history[current.historyIndex] !== path) return;
          setTabResult(tab.id, { error: String(error) });
        })
        .finally(() => {
          if (inFlight.current.get(tab.id) === path) {
            inFlight.current.delete(tab.id);
          }
        });
    }
  }, [tabs, setTabResult]);
}
