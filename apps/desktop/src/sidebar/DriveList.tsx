import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DriveInfo } from "../types/filesystem";
import { useExplorerStore } from "../stores/useExplorerStore";
import { formatSize } from "../explorer/FileList";
import CollapsibleSection from "./CollapsibleSection";

const POLL_INTERVAL_MS = 5000;

function DriveList() {
  const [drives, setDrives] = useState<DriveInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigateTo = useExplorerStore((state) => state.navigateTo);

  // Shared by every refresh trigger below (mount, window focus, the poll, and the manual
  // button) so there's exactly one place that decides how a refresh updates state. Only the
  // very first call (drives === null) leaves the user looking at "Loading…" -- every later call
  // keeps showing the last known list while this quietly re-fetches in the background, so
  // refocusing the window or the 5s poll never flashes the sidebar empty.
  const refreshDrives = useCallback(() => {
    invoke<DriveInfo[]>("get_drives")
      .then((result) => {
        setDrives(result);
        setError(null);
      })
      .catch((err: unknown) => setError(String(err)));
  }, []);

  useEffect(() => {
    refreshDrives();
  }, [refreshDrives]);

  useEffect(() => {
    window.addEventListener("focus", refreshDrives);
    return () => window.removeEventListener("focus", refreshDrives);
  }, [refreshDrives]);

  useEffect(() => {
    const id = setInterval(refreshDrives, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshDrives]);

  return (
    <CollapsibleSection sectionId="drives" title="Drives">
      <button type="button" className="sidebar__refresh-button" onClick={refreshDrives}>
        Refresh
      </button>
      {error && drives === null ? (
        <p className="sidebar__message sidebar__message--error">{error}</p>
      ) : drives === null ? (
        <p className="sidebar__message">Loading…</p>
      ) : (
        <ul className="sidebar__list">
          {drives.map((drive) => {
            const usedFraction =
              drive.totalBytes && drive.totalBytes > 0 && drive.freeBytes !== null
                ? (drive.totalBytes - drive.freeBytes) / drive.totalBytes
                : null;
            return (
              <li key={drive.path}>
                <button className="sidebar__item sidebar__item--drive" onClick={() => navigateTo(drive.path)}>
                  <span className="sidebar__drive-name">{drive.name}</span>
                  {usedFraction !== null && (
                    <>
                      <span className="sidebar__drive-bar">
                        <span
                          className="sidebar__drive-bar-fill"
                          style={{ width: `${Math.round(usedFraction * 100)}%` }}
                        />
                      </span>
                      <span className="sidebar__drive-space">
                        {formatSize(drive.freeBytes)} free of {formatSize(drive.totalBytes)}
                      </span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </CollapsibleSection>
  );
}

export default DriveList;
