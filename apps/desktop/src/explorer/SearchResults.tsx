import { useExplorerStore } from "../stores/useExplorerStore";
import { SEARCH_RESULT_CAP, useSearchStore } from "../stores/useSearchStore";
import { formatSize, formatModified } from "./FileList";
import "./SearchResults.css";

/** True once results hit the cap -- a heuristic, not an exact "there are more" signal (a search
 * that happens to match exactly SEARCH_RESULT_CAP results and no more would also show this),
 * chosen because an exact count would require a second COUNT(*) query on every search, working
 * against the whole point of this cap. */
export function isTruncated(resultCount: number): boolean {
  return resultCount === SEARCH_RESULT_CAP;
}

function parentOf(path: string): string {
  const separator = /^[a-zA-Z]:\\/.test(path) ? "\\" : "/";
  const index = path.lastIndexOf(separator);
  return index <= 0 ? path : path.slice(0, index);
}

function SearchResults() {
  const results = useSearchStore((state) => state.results);
  const loading = useSearchStore((state) => state.loading);
  const error = useSearchStore((state) => state.error);
  const setActive = useSearchStore((state) => state.setActive);
  const navigateTo = useExplorerStore((state) => state.navigateTo);
  const setSelected = useExplorerStore((state) => state.setSelected);

  function openResult(path: string) {
    navigateTo(parentOf(path));
    setSelected(path);
    setActive(false);
  }

  if (error) {
    return <div className="search-results-message search-results-message--error">{error}</div>;
  }

  if (loading) {
    return <div className="search-results-message">Searching…</div>;
  }

  if (results.length === 0) {
    return <div className="search-results-message">No matches yet — enter a search and press Enter.</div>;
  }

  return (
    <>
      {isTruncated(results.length) && (
        <p className="search-results__truncated-banner">
          ⚠ Showing first {SEARCH_RESULT_CAP} results. Narrow your search to see everything.
        </p>
      )}
      <table className="search-results">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Location</th>
            <th scope="col">Size</th>
            <th scope="col">Modified</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr
              key={result.path}
              className="search-results__row"
              tabIndex={0}
              onDoubleClick={() => openResult(result.path)}
              onKeyDown={(event) => {
                if (event.key === "Enter") openResult(result.path);
              }}
            >
              <td>
                {result.isDir ? "\u{1F4C1} " : "\u{1F4C4} "}
                {result.name}
              </td>
              <td className="search-results__location">{parentOf(result.path)}</td>
              <td>{formatSize(result.size)}</td>
              <td>{formatModified(result.modified ? String(result.modified) : null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default SearchResults;
