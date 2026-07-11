import DriveList from "./DriveList";
import FavoritesList from "./FavoritesList";
import PluginPanel from "./PluginPanel";
import { usePluginStore } from "../stores/usePluginStore";
import "./Sidebar.css";

function Sidebar() {
  const panels = usePluginStore((state) => state.panels);

  return (
    <aside className="sidebar">
      <FavoritesList />
      <DriveList />
      {panels.map((panel) => (
        <PluginPanel key={`${panel.pluginId}:${panel.id}`} panel={panel} />
      ))}
    </aside>
  );
}

export default Sidebar;
