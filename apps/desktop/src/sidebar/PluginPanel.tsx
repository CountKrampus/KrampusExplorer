import { useEffect, useRef, useState } from "react";
import type { RegisteredSidebarPanel } from "../stores/usePluginStore";
import CollapsibleSection from "./CollapsibleSection";

interface PluginPanelProps {
  panel: RegisteredSidebarPanel;
}

function PluginPanel({ panel }: PluginPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setError(null);
    let cleanup: void | (() => void);
    try {
      cleanup = panel.render(container);
    } catch (err) {
      setError(String(err));
      return;
    }
    return () => {
      try {
        cleanup?.();
      } catch {
        // The panel is being torn down anyway; a throwing cleanup shouldn't block that.
      }
      container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.pluginId, panel.id]);

  return (
    <CollapsibleSection sectionId={`${panel.pluginId}:${panel.id}`} title={panel.title}>
      {error ? (
        <p className="sidebar__message sidebar__message--error">
          "{panel.title}" failed to load: {error}
        </p>
      ) : (
        <div ref={containerRef} />
      )}
    </CollapsibleSection>
  );
}

export default PluginPanel;
