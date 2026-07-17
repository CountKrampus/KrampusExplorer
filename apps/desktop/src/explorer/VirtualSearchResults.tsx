import { memo, useMemo } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { useElementSize } from "../hooks/useElementSize";
import { formatModified, formatSize } from "./FileList";
import { parentOf } from "./SearchResultsTable";
import type { SearchResult } from "../stores/useSearchStore";

const GRID_TEMPLATE_COLUMNS = "1fr 1fr 90px 170px";

/** Search results have no icon-size setting (unlike the file list), so this is a single fixed
 * height rather than a per-icon-size table like FileList's ROW_HEIGHT_PX. */
const SEARCH_ROW_HEIGHT_PX = 28;

interface RowData {
  results: SearchResult[];
  onOpen: (path: string) => void;
}

const VirtualSearchRow = memo(function VirtualSearchRow({
  index,
  style,
  data,
}: ListChildComponentProps<RowData>) {
  const result = data.results[index];

  return (
    <div
      role="row"
      tabIndex={0}
      style={{ ...style, display: "grid", gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
      className="search-results__row search-results__row--grid"
      onDoubleClick={() => data.onOpen(result.path)}
      onKeyDown={(event) => {
        if (event.key === "Enter") data.onOpen(result.path);
      }}
    >
      <div role="gridcell">
        {result.isDir ? "\u{1F4C1} " : "\u{1F4C4} "}
        {result.name}
      </div>
      <div role="gridcell" className="search-results__location">
        {parentOf(result.path)}
      </div>
      <div role="gridcell">{formatSize(result.size)}</div>
      <div role="gridcell">{formatModified(result.modified ? String(result.modified) : null)}</div>
    </div>
  );
});

export interface VirtualSearchResultsProps {
  results: SearchResult[];
  onOpen: (path: string) => void;
}

function VirtualSearchResults({ results, onOpen }: VirtualSearchResultsProps) {
  const [sizeRef, size] = useElementSize<HTMLDivElement>();

  const itemData = useMemo<RowData>(() => ({ results, onOpen }), [results, onOpen]);

  return (
    <div role="table" className="search-results search-results--virtual">
      <div role="row" className="search-results__header-row" style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}>
        <div role="columnheader">Name</div>
        <div role="columnheader">Location</div>
        <div role="columnheader">Size</div>
        <div role="columnheader">Modified</div>
      </div>
      <div ref={sizeRef} role="rowgroup" className="search-results__virtual-body">
        {size.height > 0 && (
          <FixedSizeList
            height={size.height}
            width={size.width}
            itemCount={results.length}
            itemSize={SEARCH_ROW_HEIGHT_PX}
            itemData={itemData}
            style={{ overflowY: "scroll" }}
          >
            {VirtualSearchRow}
          </FixedSizeList>
        )}
      </div>
    </div>
  );
}

export default VirtualSearchResults;
