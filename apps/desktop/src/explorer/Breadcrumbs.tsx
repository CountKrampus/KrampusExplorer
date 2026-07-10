import { useActiveTab, useExplorerStore } from "../stores/useExplorerStore";
import "./Breadcrumbs.css";

interface Crumb {
  label: string;
  path: string;
}

function splitPath(path: string): Crumb[] {
  const isWindows = /^[a-zA-Z]:\\/.test(path);
  const separator = isWindows ? "\\" : "/";
  const parts = path.split(separator).filter(Boolean);

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
  const activeTab = useActiveTab();
  const navigateTo = useExplorerStore((state) => state.navigateTo);

  if (!activeTab) return null;
  const path = activeTab.history[activeTab.historyIndex];
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
