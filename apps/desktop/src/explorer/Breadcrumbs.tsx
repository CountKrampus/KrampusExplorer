import { useExplorerStore } from "../stores/useExplorerStore";
import "./Breadcrumbs.css";

interface Crumb {
  label: string;
  path: string;
}

export function splitPath(path: string): Crumb[] {
  const isWindows = /^[a-zA-Z]:\\/.test(path);
  const separator = isWindows ? "\\" : "/";
  const parts = path.split(separator).filter(Boolean);

  if (parts.length === 0) {
    return isWindows ? [] : [{ label: "/", path: "/" }];
  }

  const crumbs: Crumb[] = [];
  let current = "";

  parts.forEach((part, index) => {
    if (isWindows && index === 0) {
      current = `${part}${separator}`;
    } else {
      current = current.endsWith(separator) ? `${current}${part}` : `${current}${separator}${part}`;
    }
    crumbs.push({ label: part, path: current });
  });

  return crumbs;
}

function Breadcrumbs() {
  // A primitive (string) selector so this only re-renders when the current path actually
  // changes, not on every selection click or unrelated tab field update.
  const path = useExplorerStore((state) => {
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return tab ? tab.history[tab.historyIndex] : null;
  });
  const navigateTo = useExplorerStore((state) => state.navigateTo);

  if (path === null) return null;
  const crumbs = splitPath(path);

  return (
    <div className="breadcrumbs">
      {crumbs.map((crumb, index) => (
        <span key={crumb.path}>
          <button className="breadcrumbs__crumb" onClick={() => navigateTo(crumb.path)}>
            {crumb.label}
          </button>
          {index < crumbs.length - 1 && <span className="breadcrumbs__separator">/</span>}
        </span>
      ))}
    </div>
  );
}

export default Breadcrumbs;
