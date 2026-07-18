// Entry point for the "Clear Unnecessary Files" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", getKnownFolder: "system.paths", listDirectory:
// "fs.list", deleteEntries: "fs.trash", confirm: "ui.confirm").

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Each category resolves its base path from one of the four fixed `getKnownFolder` identifiers
// plus a hardcoded suffix -- the backend stays generic (it has no idea what "Chrome Cache" is),
// all category-specific knowledge lives here, matching how duplicate-finder/disk-usage-visualizer
// keep their domain logic in JS against generic scanDirectory/hashFiles primitives.
const CATEGORIES = [
  {
    id: "temp",
    group: "System",
    name: "Temp Files",
    description: "Scratch files apps leave behind in your temp folder.",
    base: "temp",
    suffix: "",
  },
  {
    id: "chrome-cache",
    group: "Browsers",
    name: "Chrome Cache",
    description: "Google Chrome's browser cache.",
    base: "local_app_data",
    suffix: "\\Google\\Chrome\\User Data\\Default\\Cache",
  },
  {
    id: "edge-cache",
    group: "Browsers",
    name: "Edge Cache",
    description: "Microsoft Edge's browser cache.",
    base: "local_app_data",
    suffix: "\\Microsoft\\Edge\\User Data\\Default\\Cache",
  },
  {
    id: "thumbnail-cache",
    group: "System",
    name: "Explorer Thumbnail Cache",
    description: "Cached thumbnail images; Windows regenerates these as needed.",
    base: "local_app_data",
    suffix: "\\Microsoft\\Windows\\Explorer",
    filter: (name) => /^thumbcache_.*\.db$/i.test(name),
  },
  {
    id: "npm-cache",
    group: "Developer Tools",
    name: "npm Cache",
    description: "Re-downloadable npm package cache.",
    base: "roaming_app_data",
    suffix: "\\npm-cache",
  },
  {
    id: "yarn-cache",
    group: "Developer Tools",
    name: "Yarn Cache",
    description: "Re-downloadable Yarn package cache.",
    base: "local_app_data",
    suffix: "\\Yarn\\Cache",
  },
  {
    id: "pip-cache",
    group: "Developer Tools",
    name: "pip Cache",
    description: "Re-downloadable Python package cache.",
    base: "local_app_data",
    suffix: "\\pip\\Cache",
  },
  {
    id: "cargo-cache",
    group: "Developer Tools",
    name: "Cargo Registry Cache",
    description: "Re-downloadable Rust crate registry cache.",
    base: "home",
    suffix: "\\.cargo\\registry\\cache",
  },
];

api.registerSidebarPanel({
  id: "clear-unnecessary-files",
  title: "Clear Unnecessary Files",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const scanBtn = document.createElement("button");
    scanBtn.textContent = "Scan";
    scanBtn.style.padding = "5px 10px";
    scanBtn.style.fontSize = "12px";
    scanBtn.style.cursor = "pointer";

    const cleanBtn = document.createElement("button");
    cleanBtn.textContent = "Clean Selected";
    cleanBtn.style.padding = "5px 10px";
    cleanBtn.style.fontSize = "12px";
    cleanBtn.style.cursor = "pointer";
    cleanBtn.disabled = true;

    const toolbar = document.createElement("div");
    toolbar.style.display = "flex";
    toolbar.style.gap = "6px";
    toolbar.appendChild(scanBtn);
    toolbar.appendChild(cleanBtn);

    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "10px";

    // Per-category scan results: { paths: string[], totalSize: number } | "not-found" | null
    // (null = not scanned yet).
    const results = new Map();
    const checkboxes = new Map();

    function updateCleanButton() {
      const anySelected = CATEGORIES.some((category) => {
        const result = results.get(category.id);
        return (
          checkboxes.get(category.id)?.checked &&
          result &&
          result !== "not-found" &&
          result.paths.length > 0
        );
      });
      cleanBtn.disabled = !anySelected;
    }

    function render() {
      list.innerHTML = "";
      checkboxes.clear();

      const groups = [...new Set(CATEGORIES.map((category) => category.group))];
      for (const group of groups) {
        const heading = document.createElement("div");
        heading.textContent = group;
        heading.style.fontWeight = "600";
        heading.style.marginTop = "4px";
        list.appendChild(heading);

        for (const category of CATEGORIES.filter((c) => c.group === group)) {
          const row = document.createElement("div");
          row.style.display = "flex";
          row.style.alignItems = "flex-start";
          row.style.gap = "6px";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.style.marginTop = "3px";
          const result = results.get(category.id);
          checkbox.disabled = !result || result === "not-found" || result.paths.length === 0;
          checkbox.addEventListener("change", updateCleanButton);
          checkboxes.set(category.id, checkbox);

          const label = document.createElement("div");
          const nameLine = document.createElement("div");
          nameLine.textContent = category.name;
          const descLine = document.createElement("div");
          descLine.style.color = "var(--fg-muted)";
          descLine.style.fontSize = "11px";
          descLine.textContent = category.description;
          const sizeLine = document.createElement("div");
          sizeLine.style.color = "var(--fg-muted)";
          sizeLine.style.fontSize = "11px";
          if (result === undefined) {
            sizeLine.textContent = "Not scanned";
          } else if (result === "not-found") {
            sizeLine.textContent = "Not found";
          } else {
            sizeLine.textContent = `${result.paths.length} item${result.paths.length === 1 ? "" : "s"} — ${formatSize(result.totalSize)}`;
          }

          label.appendChild(nameLine);
          label.appendChild(descLine);
          label.appendChild(sizeLine);

          row.appendChild(checkbox);
          row.appendChild(label);
          list.appendChild(row);
        }
      }

      updateCleanButton();
    }

    async function scanCategory(category) {
      const base = await api.getKnownFolder(category.base);
      if (!base) return "not-found";

      const path = base + category.suffix;
      let entries;
      try {
        entries = await api.listDirectory(path);
      } catch {
        return "not-found";
      }

      const matched = category.filter ? entries.filter((entry) => category.filter(entry.name)) : entries;
      return {
        paths: matched.map((entry) => entry.path),
        totalSize: matched.reduce((sum, entry) => sum + entry.size, 0),
      };
    }

    scanBtn.addEventListener("click", async () => {
      scanBtn.disabled = true;
      cleanBtn.disabled = true;
      setStatus("Scanning…", false);
      try {
        for (const category of CATEGORIES) {
          results.set(category.id, await scanCategory(category));
          render();
        }
        setStatus("Scan complete.", false);
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        scanBtn.disabled = false;
      }
    });

    cleanBtn.addEventListener("click", async () => {
      const selected = CATEGORIES.filter((category) => checkboxes.get(category.id)?.checked);
      const allPaths = [];
      let totalSize = 0;
      for (const category of selected) {
        const result = results.get(category.id);
        if (!result || result === "not-found") continue;
        allPaths.push(...result.paths);
        totalSize += result.totalSize;
      }
      if (allPaths.length === 0) return;

      const ok = await api.confirm(
        `Move ${allPaths.length} item${allPaths.length === 1 ? "" : "s"} (~${formatSize(totalSize)}) across ${selected.length} categor${selected.length === 1 ? "y" : "ies"} to the Recycle Bin?`,
      );
      if (!ok) return;

      cleanBtn.disabled = true;
      setStatus("Cleaning…", false);
      try {
        await api.deleteEntries(allPaths);
        setStatus("Done. Re-scanning…", false);
        for (const category of CATEGORIES) {
          results.set(category.id, await scanCategory(category));
          render();
        }
        setStatus("Scan complete.", false);
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    render();

    container.appendChild(toolbar);
    container.appendChild(status);
    container.appendChild(list);
  },
});
