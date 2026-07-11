import { useEffect, useState } from "react";
import { useSearchStore } from "../stores/useSearchStore";
import "./SearchBar.css";

function SearchBar() {
  const filters = useSearchStore((state) => state.filters);
  const setFilters = useSearchStore((state) => state.setFilters);
  const runSearch = useSearchStore((state) => state.runSearch);
  const setActive = useSearchStore((state) => state.setActive);
  const history = useSearchStore((state) => state.history);
  const loadHistory = useSearchStore((state) => state.loadHistory);
  const clearHistory = useSearchStore((state) => state.clearHistory);
  const saved = useSearchStore((state) => state.saved);
  const loadSaved = useSearchStore((state) => state.loadSaved);
  const saveCurrentSearch = useSearchStore((state) => state.saveCurrentSearch);
  const deleteSaved = useSearchStore((state) => state.deleteSaved);
  const runSavedSearch = useSearchStore((state) => state.runSavedSearch);

  const [showFilters, setShowFilters] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    void loadHistory();
    void loadSaved();
  }, [loadHistory, loadSaved]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setShowHistory(false);
    void runSearch();
  }

  function handleSave() {
    const name = window.prompt("Save this search as:");
    if (name && name.trim()) {
      void saveCurrentSearch(name.trim());
    }
  }

  return (
    <div className="search-bar">
      <form className="search-bar__row" onSubmit={handleSubmit}>
        <button
          type="button"
          className="search-bar__close"
          onClick={() => setActive(false)}
          aria-label="Exit search"
          title="Exit search"
        >
          &#x2190;
        </button>
        <input
          className="search-bar__input"
          type="text"
          placeholder="Search this folder…"
          value={filters.name}
          onChange={(event) => setFilters({ name: event.target.value })}
          onFocus={() => setShowHistory(true)}
          onBlur={() => setTimeout(() => setShowHistory(false), 150)}
          autoFocus
        />
        <button type="submit">Search</button>
        <button type="button" onClick={() => setShowFilters((v) => !v)}>
          Filters
        </button>
        <button type="button" onClick={() => setShowSaved((v) => !v)}>
          Saved
        </button>
        <button type="button" onClick={handleSave}>
          Save
        </button>
      </form>

      {showHistory && history.length > 0 && (
        <div className="search-bar__panel">
          <div className="search-bar__panel-heading">
            Recent searches
            <button
              type="button"
              className="search-bar__link"
              onClick={() => void clearHistory()}
            >
              Clear
            </button>
          </div>
          <ul className="search-bar__list">
            {history.map((entry, index) => (
              <li key={`${entry.searchedAt}-${index}`}>
                <button
                  type="button"
                  onClick={() => {
                    setFilters({ name: entry.query });
                    setShowHistory(false);
                    void runSearch();
                  }}
                >
                  {entry.query}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showFilters && (
        <div className="search-bar__panel search-bar__filters">
          <label>
            Type
            <select
              value={filters.fileType}
              onChange={(event) => setFilters({ fileType: event.target.value as "file" | "folder" | "" })}
            >
              <option value="">Any</option>
              <option value="file">Files</option>
              <option value="folder">Folders</option>
            </select>
          </label>
          <label>
            Min size (MB)
            <input
              type="number"
              min="0"
              value={filters.minSize}
              onChange={(event) => setFilters({ minSize: event.target.value })}
            />
          </label>
          <label>
            Max size (MB)
            <input
              type="number"
              min="0"
              value={filters.maxSize}
              onChange={(event) => setFilters({ maxSize: event.target.value })}
            />
          </label>
          <label>
            Modified after
            <input
              type="date"
              value={filters.modifiedAfter}
              onChange={(event) => setFilters({ modifiedAfter: event.target.value })}
            />
          </label>
          <label>
            Modified before
            <input
              type="date"
              value={filters.modifiedBefore}
              onChange={(event) => setFilters({ modifiedBefore: event.target.value })}
            />
          </label>
        </div>
      )}

      {showSaved && (
        <div className="search-bar__panel">
          <div className="search-bar__panel-heading">Saved searches</div>
          {saved.length === 0 ? (
            <p className="search-bar__empty">No saved searches yet.</p>
          ) : (
            <ul className="search-bar__list">
              {saved.map((entry) => (
                <li key={entry.name} className="search-bar__saved-item">
                  <button type="button" onClick={() => void runSavedSearch(entry)}>
                    {entry.name}
                  </button>
                  <button
                    type="button"
                    className="search-bar__link"
                    onClick={() => void deleteSaved(entry.name)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
