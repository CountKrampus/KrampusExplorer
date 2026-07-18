// Entry point for the "Disk Usage Visualizer" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", getCurrentPath/onFolderChange: "nav.read",
// scanDirectory: "fs.scan").

/** Must match crates/plugins/src/scan.rs's SCAN_FILE_CAP. */
const SCAN_FILE_CAP = 50000;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Buckets a file's absolute path under the name of the immediate child of `root` it lives in
// (a folder, or the file itself if it sits directly in `root`) — a single-level breakdown of
// what's taking up space, not a full nested treemap (this plugin renders with plain DOM/CSS,
// no charting library).
function topSegment(root, filePath) {
  const sep = filePath.includes("\\") ? "\\" : "/";
  let rel = filePath.slice(root.length);
  if (rel.startsWith(sep)) rel = rel.slice(1);
  const idx = rel.indexOf(sep);
  return idx === -1 ? rel : rel.slice(0, idx);
}

api.registerSidebarPanel({
  id: "disk-usage-visualizer",
  title: "Disk Usage",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const rootInput = document.createElement("input");
    rootInput.type = "text";
    rootInput.placeholder = "Folder to analyze";
    rootInput.value = api.getCurrentPath?.() ?? "";
    rootInput.style.padding = "4px 6px";
    rootInput.style.fontSize = "12px";

    const scanBtn = document.createElement("button");
    scanBtn.textContent = "Analyze";
    scanBtn.style.padding = "5px 10px";
    scanBtn.style.fontSize = "12px";
    scanBtn.style.cursor = "pointer";

    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    const results = document.createElement("div");
    results.style.display = "flex";
    results.style.flexDirection = "column";
    results.style.gap = "6px";
    results.style.maxHeight = "360px";
    results.style.overflowY = "auto";

    scanBtn.addEventListener("click", async () => {
      const root = rootInput.value.trim();
      if (!root) {
        setStatus("Enter a folder to analyze.", true);
        return;
      }
      scanBtn.disabled = true;
      results.innerHTML = "";
      setStatus("Scanning…", false);
      try {
        const files = await api.scanDirectory(root);

        const bySegment = new Map();
        let total = 0;
        for (const file of files) {
          const segment = topSegment(root, file.path) || "(this folder)";
          bySegment.set(segment, (bySegment.get(segment) ?? 0) + file.size);
          total += file.size;
        }

        if (total === 0) {
          setStatus("No files found under this folder.", false);
          scanBtn.disabled = false;
          return;
        }

        const entries = [...bySegment.entries()].sort((a, b) => b[1] - a[1]);
        const truncatedNote =
          files.length === SCAN_FILE_CAP
            ? ` (scanned first ${SCAN_FILE_CAP.toLocaleString()} files -- results may be incomplete, try a narrower folder)`
            : "";
        setStatus(
          `${formatSize(total)} total across ${entries.length} item${entries.length === 1 ? "" : "s"}${truncatedNote}`,
          false,
        );

        const max = entries[0][1];
        for (const [name, size] of entries) {
          const row = document.createElement("div");
          row.style.display = "flex";
          row.style.flexDirection = "column";
          row.style.gap = "2px";

          const label = document.createElement("div");
          label.style.display = "flex";
          label.style.justifyContent = "space-between";
          label.style.gap = "8px";

          const nameSpan = document.createElement("span");
          nameSpan.textContent = name;
          nameSpan.style.overflow = "hidden";
          nameSpan.style.textOverflow = "ellipsis";
          nameSpan.style.whiteSpace = "nowrap";

          const sizeSpan = document.createElement("span");
          sizeSpan.textContent = `${formatSize(size)} (${((size / total) * 100).toFixed(1)}%)`;
          sizeSpan.style.color = "var(--fg-muted)";
          sizeSpan.style.flexShrink = "0";

          label.appendChild(nameSpan);
          label.appendChild(sizeSpan);

          const barTrack = document.createElement("div");
          barTrack.style.height = "6px";
          barTrack.style.borderRadius = "3px";
          barTrack.style.background = "var(--border)";
          barTrack.style.overflow = "hidden";

          const barFill = document.createElement("div");
          barFill.style.height = "100%";
          barFill.style.width = `${((size / max) * 100).toFixed(1)}%`;
          barFill.style.background = "var(--accent)";
          barTrack.appendChild(barFill);

          row.appendChild(label);
          row.appendChild(barTrack);
          results.appendChild(row);
        }
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        scanBtn.disabled = false;
      }
    });

    const unsubscribe = api.onFolderChange?.((path) => {
      rootInput.value = path;
    });

    container.appendChild(rootInput);
    container.appendChild(scanBtn);
    container.appendChild(status);
    container.appendChild(results);

    return () => {
      unsubscribe?.();
    };
  },
});
