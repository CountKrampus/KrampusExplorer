import TabBar from "./TabBar";
import Breadcrumbs from "./Breadcrumbs";
import FileList from "./FileList";
import SearchBar from "./SearchBar";
import SearchResults from "./SearchResults";
import { useSearchStore } from "../stores/useSearchStore";
import "./Explorer.css";

function Explorer() {
  const searching = useSearchStore((state) => state.active);

  return (
    <div className="explorer">
      <TabBar />
      {searching ? (
        <>
          <SearchBar />
          <div className="explorer__content">
            <SearchResults />
          </div>
        </>
      ) : (
        <>
          <Breadcrumbs />
          <div className="explorer__content">
            <FileList />
          </div>
        </>
      )}
    </div>
  );
}

export default Explorer;
