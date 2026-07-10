import TabBar from "./TabBar";
import Breadcrumbs from "./Breadcrumbs";
import FileList from "./FileList";
import "./Explorer.css";

function Explorer() {
  return (
    <div className="explorer">
      <TabBar />
      <Breadcrumbs />
      <div className="explorer__content">
        <FileList />
      </div>
    </div>
  );
}

export default Explorer;
