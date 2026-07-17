import { formatModified, formatSize } from "./FileList";
import type { SearchResult } from "../stores/useSearchStore";

export function parentOf(path: string): string {
  const separator = /^[a-zA-Z]:\\/.test(path) ? "\\" : "/";
  const index = path.lastIndexOf(separator);
  return index <= 0 ? path : path.slice(0, index);
}

export interface SearchResultsTableProps {
  results: SearchResult[];
  onOpen: (path: string) => void;
}

function SearchResultsTable({ results, onOpen }: SearchResultsTableProps) {
  return (
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
            onDoubleClick={() => onOpen(result.path)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(result.path);
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
  );
}

export default SearchResultsTable;
