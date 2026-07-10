import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DriveInfo } from "../types/filesystem";
import { useExplorerStore } from "../stores/useExplorerStore";

function DriveList() {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const navigateTo = useExplorerStore((state) => state.navigateTo);

  useEffect(() => {
    invoke<DriveInfo[]>("get_drives")
      .then(setDrives)
      .catch(() => setDrives([]));
  }, []);

  return (
    <div className="sidebar__section">
      <div className="sidebar__heading">Drives</div>
      <ul className="sidebar__list">
        {drives.map((drive) => (
          <li key={drive.path}>
            <button className="sidebar__item" onClick={() => navigateTo(drive.path)}>
              {drive.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default DriveList;
