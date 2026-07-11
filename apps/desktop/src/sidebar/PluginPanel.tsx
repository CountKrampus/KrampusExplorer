import { useEffect, useRef } from "react";
import type { RegisteredSidebarPanel } from "../stores/usePluginStore";

interface PluginPanelProps {
  panel: RegisteredSidebarPanel;
}

function PluginPanel({ panel }: PluginPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cleanup = panel.render(container);
    return () => {
      cleanup?.();
      container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.pluginId, panel.id]);

  return (
    <div className="sidebar__section">
      <div className="sidebar__heading">{panel.title}</div>
      <div ref={containerRef} />
    </div>
  );
}

export default PluginPanel;
