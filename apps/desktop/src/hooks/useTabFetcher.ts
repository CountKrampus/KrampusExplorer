import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useExplorerStore } from "../stores/useExplorerStore";
import type { DirectoryListing } from "../types/filesystem";

export function useTabFetcher() {
  const tabs = useExplorerStore((state) => state.tabs);
  const setTabResult = useExplorerStore((state) => state.setTabResult);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    for (const tab of tabs) {
      if (!tab.loading || inFlight.current.has(tab.id)) continue;
      const path = tab.history[tab.historyIndex];
      inFlight.current.add(tab.id);

      invoke<DirectoryListing>("get_directory_listing", { path })
        .then((listing) => {
          setTabResult(tab.id, { entries: listing.entries, parent: listing.parent });
        })
        .catch((error: string) => {
          setTabResult(tab.id, { error: String(error) });
        })
        .finally(() => {
          inFlight.current.delete(tab.id);
        });
    }
  }, [tabs, setTabResult]);
}
