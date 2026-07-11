import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import "./FileList.css";

export function formatSize(size: number | null): string {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatModified(modified: string | null): string {
  if (modified === null) return "";
  const seconds = Number(modified);
  if (Number.isNaN(seconds)) return "";
  return new Date(seconds * 1000).toLocaleString();
}

function FileList() {
  const activeTab = useActiveTab();
  const navigateTo = useExplorerStore((state) => state.navigateTo);
  const refresh = useExplorerStore((state) => state.refresh);

  if (!activeTab) return null;

  if (activeTab.error) {
    return (
      <div className="file-list-message file-list-message--error">
        <p>{activeTab.error}</p>
        <button onClick={refresh}>Retry</button>
      </div>
    );
  }

  if (activeTab.loading) {
    return <div className="file-list-message">Loading…</div>;
  }

  if (activeTab.entries.length === 0) {
    return <div className="file-list-message">This folder is empty.</div>;
  }

  return (
    <table className="file-list">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Size</th>
          <th scope="col">Modified</th>
        </tr>
      </thead>
      <tbody>
        {activeTab.entries.map((entry) => (
          <tr
            key={entry.path}
            className="file-list__row"
            onDoubleClick={() => entry.isDir && navigateTo(entry.path)}
          >
            <td>
              {entry.isDir ? "\u{1F4C1} " : "\u{1F4C4} "}
              {entry.name}
            </td>
            <td>{formatSize(entry.size)}</td>
            <td>{formatModified(entry.modified)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default FileList;
