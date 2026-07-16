// Entry point for the "Batch Rename" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", getCurrentPath/onFolderChange: "nav.read",
// listDirectory: "fs.list", renameEntry: "fs.rename").
//
// Operates on every entry directly inside the loaded folder (non-recursive) — there's no
// multi-select in the core file list yet, so "batch" here means "everything in this folder"
// rather than a hand-picked subset. Use Find/Replace with an empty Find to just apply the {n}
// counter to every name, or a specific Find to target a subset of names.

function computeRenames(entries, find, replace, useRegex) {
  const total = entries.length;
  const padWidth = String(total).length;

  const results = entries.map((entry, index) => {
    const counter = String(index + 1).padStart(padWidth, "0");
    const replacementWithCounter = replace.split("{n}").join(counter);
    let newName = entry.name;
    if (find) {
      if (useRegex) {
        newName = entry.name.replace(new RegExp(find, "g"), replacementWithCounter);
      } else {
        newName = entry.name.split(find).join(replacementWithCounter);
      }
    }
    return { entry, newName, changed: newName !== entry.name };
  });

  const finalNameCounts = new Map();
  for (const r of results) {
    finalNameCounts.set(r.newName, (finalNameCounts.get(r.newName) ?? 0) + 1);
  }
  for (const r of results) {
    r.collision = finalNameCounts.get(r.newName) > 1;
  }
  return results;
}

api.registerSidebarPanel({
  id: "batch-rename",
  title: "Batch Rename",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const rootInput = document.createElement("input");
    rootInput.type = "text";
    rootInput.placeholder = "Folder to rename files in";
    rootInput.value = api.getCurrentPath?.() ?? "";
    rootInput.style.padding = "4px 6px";
    rootInput.style.fontSize = "12px";

    const loadBtn = document.createElement("button");
    loadBtn.textContent = "Load Files";
    loadBtn.style.padding = "5px 10px";
    loadBtn.style.fontSize = "12px";
    loadBtn.style.cursor = "pointer";

    const findRow = document.createElement("div");
    findRow.style.display = "flex";
    findRow.style.gap = "6px";
    const findInput = document.createElement("input");
    findInput.type = "text";
    findInput.placeholder = "Find (blank = whole name)";
    findInput.style.flex = "1";
    findInput.style.padding = "4px 6px";
    findInput.style.fontSize = "12px";
    const replaceInput = document.createElement("input");
    replaceInput.type = "text";
    replaceInput.placeholder = "Replace with — {n} = counter";
    replaceInput.style.flex = "1";
    replaceInput.style.padding = "4px 6px";
    replaceInput.style.fontSize = "12px";
    findRow.appendChild(findInput);
    findRow.appendChild(replaceInput);

    const regexLabel = document.createElement("label");
    regexLabel.style.display = "flex";
    regexLabel.style.alignItems = "center";
    regexLabel.style.gap = "4px";
    const regexCheckbox = document.createElement("input");
    regexCheckbox.type = "checkbox";
    regexLabel.appendChild(regexCheckbox);
    regexLabel.appendChild(document.createTextNode(" Use regex (supports $1, $2 groups)"));

    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    const previewTable = document.createElement("table");
    previewTable.style.width = "100%";
    previewTable.style.borderCollapse = "collapse";
    previewTable.style.fontSize = "11px";
    const previewBody = document.createElement("tbody");
    previewTable.appendChild(previewBody);
    const previewWrap = document.createElement("div");
    previewWrap.style.maxHeight = "280px";
    previewWrap.style.overflowY = "auto";
    previewWrap.appendChild(previewTable);

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply Rename";
    applyBtn.style.padding = "5px 10px";
    applyBtn.style.fontSize = "12px";
    applyBtn.style.cursor = "pointer";
    applyBtn.disabled = true;

    let entries = [];
    let currentResults = [];

    function renderPreview() {
      previewBody.innerHTML = "";
      if (entries.length === 0) {
        applyBtn.disabled = true;
        return;
      }

      let results;
      try {
        results = computeRenames(entries, findInput.value, replaceInput.value, regexCheckbox.checked);
      } catch (error) {
        setStatus(`Invalid regex: ${String(error)}`, true);
        applyBtn.disabled = true;
        return;
      }
      currentResults = results;

      const hasCollision = results.some((r) => r.collision);
      const changedCount = results.filter((r) => r.changed).length;

      for (const r of results) {
        const row = document.createElement("tr");
        if (r.collision) row.style.color = "var(--danger, #d33)";
        else if (!r.changed) row.style.color = "var(--fg-muted)";

        const oldCell = document.createElement("td");
        oldCell.textContent = r.entry.name;
        oldCell.style.padding = "2px 4px";
        const arrowCell = document.createElement("td");
        arrowCell.textContent = "→";
        arrowCell.style.padding = "2px 4px";
        const newCell = document.createElement("td");
        newCell.textContent = r.newName;
        newCell.style.padding = "2px 4px";

        row.appendChild(oldCell);
        row.appendChild(arrowCell);
        row.appendChild(newCell);
        previewBody.appendChild(row);
      }

      if (hasCollision) {
        setStatus("Name collision — fix before applying.", true);
        applyBtn.disabled = true;
      } else {
        setStatus(`${changedCount} of ${entries.length} file${entries.length === 1 ? "" : "s"} will be renamed`, false);
        applyBtn.disabled = changedCount === 0;
      }
    }

    [findInput, replaceInput].forEach((input) => input.addEventListener("input", renderPreview));
    regexCheckbox.addEventListener("change", renderPreview);

    loadBtn.addEventListener("click", async () => {
      const root = rootInput.value.trim();
      if (!root) {
        setStatus("Enter a folder.", true);
        return;
      }
      loadBtn.disabled = true;
      setStatus("Loading…", false);
      try {
        entries = (await api.listDirectory(root)).slice().sort((a, b) => a.name.localeCompare(b.name));
        setStatus(`${entries.length} item${entries.length === 1 ? "" : "s"} loaded`, false);
        renderPreview();
      } catch (error) {
        setStatus(String(error), true);
        entries = [];
      } finally {
        loadBtn.disabled = false;
      }
    });

    applyBtn.addEventListener("click", async () => {
      const toRename = currentResults.filter((r) => r.changed && !r.collision);
      if (toRename.length === 0) return;
      applyBtn.disabled = true;
      let done = 0;
      let failed = 0;
      for (const r of toRename) {
        setStatus(`Renaming ${done + 1} of ${toRename.length}…`, false);
        try {
          await api.renameEntry(r.entry.path, r.newName);
          done++;
        } catch (error) {
          failed++;
          setStatus(`Failed on "${r.entry.name}": ${String(error)}`, true);
        }
      }
      if (failed === 0) {
        setStatus(`Renamed ${done} file${done === 1 ? "" : "s"}.`, false);
      }
      // Reload from disk so the preview reflects the entries' new names rather than assuming
      // every rename succeeded.
      const root = rootInput.value.trim();
      try {
        entries = (await api.listDirectory(root)).slice().sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        entries = [];
      }
      findInput.value = "";
      replaceInput.value = "";
      renderPreview();
    });

    const unsubscribe = api.onFolderChange?.((path) => {
      rootInput.value = path;
    });

    container.appendChild(rootInput);
    container.appendChild(loadBtn);
    container.appendChild(findRow);
    container.appendChild(regexLabel);
    container.appendChild(status);
    container.appendChild(previewWrap);
    container.appendChild(applyBtn);

    return () => {
      unsubscribe?.();
    };
  },
});
