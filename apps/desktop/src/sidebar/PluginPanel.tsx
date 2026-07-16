import { useEffect, useRef, useState } from "react";
import type { RegisteredSidebarPanel } from "../stores/usePluginStore";

interface PluginPanelProps {
  panel: RegisteredSidebarPanel;
  /** Whether this is the panel currently selected in the icon rail. Hidden via CSS rather than
   * unmounted when not active — `panel.render()`'s effect only fires once per mount (keyed on
   * plugin id, not on active state), so unmounting on deselect would mean it never re-runs when
   * reselected, leaving the panel permanently blank after one switch-away/switch-back cycle. */
  active: boolean;
}

function PluginPanel({ panel, active }: PluginPanelProps) {
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
    <div className="sidebar__plugin-panel" style={active ? undefined : { display: "none" }}>
      <h3 className="sidebar__heading">{panel.title}</h3>
      {error ? (
        <p className="sidebar__message sidebar__message--error">
          "{panel.title}" failed to load: {error}
        </p>
      ) : (
        <div ref={containerRef} />
      )}
    </div>
  );
}

export default PluginPanel;
