import DriveList from "./DriveList";
import FavoritesList from "./FavoritesList";
import "./Sidebar.css";

function Sidebar() {
  return (
    <aside className="sidebar">
      <FavoritesList />
      <DriveList />
    </aside>
  );
}

export default Sidebar;
