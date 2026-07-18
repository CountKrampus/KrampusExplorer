// Entry point for the "Recycling Bin" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", listTrashItems/restoreTrashItem/purgeTrashItem/
// emptyTrash: "fs.trash", confirm: "ui.confirm").

function formatSize(bytes) {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDeleted(epochSeconds) {
  return new Date(epochSeconds * 1000).toLocaleString();
}

api.registerSidebarPanel({
  id: "recycling-bin",
  title: "Recycling Bin",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const toolbar = document.createElement("div");
    toolbar.style.display = "flex";
    toolbar.style.gap = "6px";

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.style.padding = "5px 10px";
    refreshBtn.style.fontSize = "12px";
    refreshBtn.style.cursor = "pointer";

    const emptyBtn = document.createElement("button");
    emptyBtn.textContent = "Empty Recycle Bin";
    emptyBtn.style.padding = "5px 10px";
    emptyBtn.style.fontSize = "12px";
    emptyBtn.style.cursor = "pointer";

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
    list.style.gap = "6px";
    list.style.maxHeight = "400px";
    list.style.overflowY = "auto";

    let items = [];

    function render() {
      list.innerHTML = "";
      emptyBtn.disabled = items.length === 0;
      if (items.length === 0) {
        setStatus("Recycle Bin is empty.", false);
        return;
      }
      setStatus(`${items.length} item${items.length === 1 ? "" : "s"} in the Recycle Bin`, false);

      for (const item of items) {
        const row = document.createElement("div");
        row.style.border = "1px solid var(--border)";
        row.style.borderRadius = "4px";
        row.style.padding = "6px 8px";
        row.style.display = "flex";
        row.style.flexDirection = "column";
        row.style.gap = "4px";

        const nameLine = document.createElement("div");
        nameLine.style.fontWeight = "600";
        nameLine.textContent = item.name;

        const metaLine = document.createElement("div");
        metaLine.style.color = "var(--fg-muted)";
        metaLine.style.fontSize = "11px";
        metaLine.style.wordBreak = "break-all";
        const sizePart = item.sizeBytes === null ? "" : ` — ${formatSize(item.sizeBytes)}`;
        metaLine.textContent = `${item.originalParent}${sizePart} — deleted ${formatDeleted(item.timeDeleted)}`;

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "6px";

        const restoreBtn = document.createElement("button");
        restoreBtn.textContent = "Restore";
        restoreBtn.style.fontSize = "11px";
        restoreBtn.style.padding = "3px 8px";
        restoreBtn.style.cursor = "pointer";
        restoreBtn.addEventListener("click", async () => {
          try {
            await api.restoreTrashItem(item.id);
            await refresh();
          } catch (error) {
            setStatus(String(error), true);
          }
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete Forever";
        deleteBtn.style.fontSize = "11px";
        deleteBtn.style.padding = "3px 8px";
        deleteBtn.style.cursor = "pointer";
        deleteBtn.addEventListener("click", async () => {
          const ok = await api.confirm(`Permanently delete '${item.name}'? This cannot be undone.`);
          if (!ok) return;
          try {
            await api.purgeTrashItem(item.id);
            await refresh();
          } catch (error) {
            setStatus(String(error), true);
          }
        });

        actions.appendChild(restoreBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(nameLine);
        row.appendChild(metaLine);
        row.appendChild(actions);
        list.appendChild(row);
      }
    }

    async function refresh() {
      try {
        items = await api.listTrashItems();
        render();
      } catch (error) {
        setStatus(String(error), true);
      }
    }

    refreshBtn.addEventListener("click", () => void refresh());

    emptyBtn.addEventListener("click", async () => {
      const ok = await api.confirm(
        `Permanently delete all ${items.length} item${items.length === 1 ? "" : "s"} in the Recycle Bin? This cannot be undone.`,
      );
      if (!ok) return;
      try {
        await api.emptyTrash();
        await refresh();
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(emptyBtn);

    container.appendChild(toolbar);
    container.appendChild(status);
    container.appendChild(list);

    void refresh();
  },
});
