// Entry point for the "Duplicate File Finder" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", getCurrentPath/onFolderChange: "nav.read",
// copyToClipboard: "clipboard.write", scanDirectory/hashFiles: "fs.scan").

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Scanning a whole system drive can turn up hundreds of thousands of same-size candidates (every
// zero-byte file on the drive is "the same size" as every other one, for instance). Hashing that
// many in a single api.hashFiles call means a single IPC round-trip carrying a result array with
// hundreds of thousands of {path, hash} entries — a real crash risk, not just a slow one. Refusing
// past a sane cap, and chunking everything under it, keeps every IPC message a bounded size.
const MAX_CANDIDATES = 20000;
const HASH_CHUNK_SIZE = 1000;

api.registerSidebarPanel({
  id: "duplicate-finder",
  title: "Duplicate Finder",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const rootInput = document.createElement("input");
    rootInput.type = "text";
    rootInput.placeholder = "Folder to scan";
    rootInput.value = api.getCurrentPath?.() ?? "";
    rootInput.style.padding = "4px 6px";
    rootInput.style.fontSize = "12px";

    const scanBtn = document.createElement("button");
    scanBtn.textContent = "Scan for Duplicates";
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
    results.style.gap = "10px";
    results.style.maxHeight = "360px";
    results.style.overflowY = "auto";

    function renderGroups(groups) {
      results.innerHTML = "";
      if (groups.length === 0) {
        setStatus("No duplicates found.", false);
        return;
      }
      const totalWasted = groups.reduce((sum, g) => sum + g.size * (g.paths.length - 1), 0);
      setStatus(
        `${groups.length} duplicate group${groups.length === 1 ? "" : "s"} — ${formatSize(totalWasted)} wasted`,
        false,
      );

      for (const group of groups) {
        const card = document.createElement("div");
        card.style.border = "1px solid var(--border)";
        card.style.borderRadius = "4px";
        card.style.padding = "6px 8px";

        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";
        header.style.marginBottom = "4px";

        const headerText = document.createElement("span");
        headerText.textContent = `${group.paths.length} copies, ${formatSize(group.size)} each`;
        headerText.style.fontWeight = "600";

        const copyBtn = document.createElement("button");
        copyBtn.textContent = "Copy paths";
        copyBtn.style.fontSize = "11px";
        copyBtn.style.padding = "2px 6px";
        copyBtn.style.cursor = "pointer";
        copyBtn.addEventListener("click", async () => {
          try {
            await api.copyToClipboard(group.paths.join("\n"));
            copyBtn.textContent = "Copied!";
            setTimeout(() => {
              copyBtn.textContent = "Copy paths";
            }, 1200);
          } catch (error) {
            setStatus(String(error), true);
          }
        });

        header.appendChild(headerText);
        header.appendChild(copyBtn);
        card.appendChild(header);

        const list = document.createElement("ul");
        list.style.margin = "0";
        list.style.padding = "0 0 0 16px";
        list.style.color = "var(--fg-muted)";
        list.style.wordBreak = "break-all";
        for (const path of group.paths) {
          const item = document.createElement("li");
          item.textContent = path;
          list.appendChild(item);
        }
        card.appendChild(list);

        results.appendChild(card);
      }
    }

    scanBtn.addEventListener("click", async () => {
      const root = rootInput.value.trim();
      if (!root) {
        setStatus("Enter a folder to scan.", true);
        return;
      }
      scanBtn.disabled = true;
      results.innerHTML = "";
      setStatus("Scanning…", false);
      try {
        const files = await api.scanDirectory(root);

        // Group by size first — hashing every file would be wasteful when most files have a
        // unique size and therefore can't possibly be duplicates of anything.
        const bySize = new Map();
        for (const file of files) {
          const bucket = bySize.get(file.size);
          if (bucket) bucket.push(file);
          else bySize.set(file.size, [file]);
        }
        const candidates = [];
        for (const bucket of bySize.values()) {
          if (bucket.length > 1) candidates.push(...bucket);
        }

        if (candidates.length === 0) {
          renderGroups([]);
          return;
        }

        if (candidates.length > MAX_CANDIDATES) {
          setStatus(
            `Found ${candidates.length} same-size candidates — that's too many to hash in one folder ` +
              `(limit ${MAX_CANDIDATES}). Try scanning a narrower folder instead of a whole drive.`,
            true,
          );
          return;
        }

        const sizeByPath = new Map(candidates.map((f) => [f.path, f.size]));
        const candidatePaths = candidates.map((f) => f.path);
        const byHash = new Map();
        for (let i = 0; i < candidatePaths.length; i += HASH_CHUNK_SIZE) {
          const chunk = candidatePaths.slice(i, i + HASH_CHUNK_SIZE);
          setStatus(
            `Hashing ${Math.min(i + HASH_CHUNK_SIZE, candidatePaths.length)} of ${candidatePaths.length} candidate files…`,
            false,
          );
          const hashes = await api.hashFiles(chunk);
          for (const { path, hash } of hashes) {
            const bucket = byHash.get(hash);
            if (bucket) bucket.push(path);
            else byHash.set(hash, [path]);
          }
        }

        const groups = [];
        for (const [hash, paths] of byHash) {
          if (paths.length > 1) groups.push({ hash, paths, size: sizeByPath.get(paths[0]) ?? 0 });
        }
        groups.sort((a, b) => b.size * (b.paths.length - 1) - a.size * (a.paths.length - 1));

        renderGroups(groups);
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
