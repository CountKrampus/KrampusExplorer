import { useCallback, useRef } from "react";
import DriveList from "./DriveList";
import FavoritesList from "./FavoritesList";
import PluginPanel from "./PluginPanel";
import IconRail, { panelKey } from "./IconRail";
import { usePluginStore } from "../stores/usePluginStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import "./Sidebar.css";

function Sidebar() {
  const panels = usePluginStore((state) => state.panels);
  const activePanelKey = useSettingsStore((state) => state.activePluginPanel);
  const width = useSettingsStore((state) => state.sidebarWidth);
  const setWidth = useSettingsStore((state) => state.setSidebarWidth);
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      // The handle sits at the sidebar's right edge, so the pointer's x position (relative to
      // the sidebar's left edge, i.e. the viewport since the sidebar is the leftmost element)
      // is the new width directly.
      setWidth(event.clientX);
    },
    [setWidth],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div className="sidebar-wrapper" style={{ width }}>
      <IconRail />
      <aside className="sidebar">
        <FavoritesList />
        <DriveList />
        {panels.length > 0 && (
          <div className="sidebar__plugin-content">
            {activePanelKey === null && (
              <p className="sidebar__message">Select a plugin icon above.</p>
            )}
            {panels.map((panel) => (
              <PluginPanel
                key={panelKey(panel.pluginId, panel.id)}
                panel={panel}
                active={panelKey(panel.pluginId, panel.id) === activePanelKey}
              />
            ))}
          </div>
        )}
      </aside>
      <div
        className="sidebar__resize-handle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />
    </div>
  );
}

export default Sidebar;
