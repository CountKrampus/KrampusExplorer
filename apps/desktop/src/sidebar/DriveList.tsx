import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DriveInfo } from "../types/filesystem";
import { useExplorerStore } from "../stores/useExplorerStore";
import { formatSize } from "../explorer/FileList";
import CollapsibleSection from "./CollapsibleSection";

function DriveList() {
  const [drives, setDrives] = useState<DriveInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigateTo = useExplorerStore((state) => state.navigateTo);

  useEffect(() => {
    invoke<DriveInfo[]>("get_drives")
      .then((result) => {
        setDrives(result);
        setError(null);
      })
      .catch((err: unknown) => setError(String(err)));
  }, []);

  return (
    <CollapsibleSection sectionId="drives" title="Drives">
      {error ? (
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
