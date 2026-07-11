import type { ReactNode } from "react";
import { useSettingsStore } from "../stores/useSettingsStore";

interface CollapsibleSectionProps {
  sectionId: string;
  title: string;
  children: ReactNode;
}

function CollapsibleSection({ sectionId, title, children }: CollapsibleSectionProps) {
  const collapsed = useSettingsStore((state) => state.collapsedSidebarSections.includes(sectionId));
  const toggle = useSettingsStore((state) => state.toggleSidebarSection);

  return (
    <div className="sidebar__section">
      <button
        type="button"
        className="sidebar__heading sidebar__heading--button"
        onClick={() => toggle(sectionId)}
        aria-expanded={!collapsed}
      >
        <span className={`sidebar__disclosure ${collapsed ? "" : "sidebar__disclosure--open"}`} aria-hidden="true">
          &#x25B8;
        </span>
        {title}
      </button>
      {/* Hidden via CSS rather than unmounted: PluginPanel's render() effect only fires once
          per mount (keyed on plugin id, not on collapsed state), so unmounting this on collapse
          would mean it never re-runs on re-expand and the panel would stay empty forever after
          one collapse/expand cycle. Hiding keeps the plugin's DOM and any subscriptions alive. */}
      <div style={collapsed ? { display: "none" } : undefined}>{children}</div>
    </div>
  );
}

export default CollapsibleSection;
