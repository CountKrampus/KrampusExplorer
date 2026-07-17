import { useExplorerStore } from "../stores/useExplorerStore";
import { SEARCH_RESULT_CAP, useSearchStore } from "../stores/useSearchStore";
import SearchResultsTable, { parentOf } from "./SearchResultsTable";
import "./SearchResults.css";

/** True once results hit the cap -- a heuristic, not an exact "there are more" signal (a search
 * that happens to match exactly SEARCH_RESULT_CAP results and no more would also show this),
 * chosen because an exact count would require a second COUNT(*) query on every search, working
 * against the whole point of this cap. */
export function isTruncated(resultCount: number): boolean {
  return resultCount === SEARCH_RESULT_CAP;
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
      <SearchResultsTable results={results} onOpen={openResult} />
    </>
  );
}

export default SearchResults;
