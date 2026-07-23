// Entry point for the "Disk Partition Manager" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", confirm: "ui.confirm", listDisks/createPartition/
// deletePartition/resizePartition/formatPartition/setDriveLetter: "system.partitions").
//
// The backend independently refuses every mutating call against the system disk -- this
// frontend's own disabling of those buttons is a second, non-authoritative layer, the same
// two-independent-checks pattern Drive Format and Secure Wipe both use.

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Computes the gaps between partitions (and after the last one) as pseudo-segments so the map
// can render unallocated space -- the backend doesn't return these explicitly, since "gap
// between known offsets" is trivial to derive client-side.
function withUnallocatedGaps(disk) {
  const sorted = [...disk.partitions].sort((a, b) => a.offsetBytes - b.offsetBytes);
  const segments = [];
  let cursor = 0;
  for (const partition of sorted) {
    if (partition.offsetBytes > cursor) {
      segments.push({ kind: "unallocated", offsetBytes: cursor, sizeBytes: partition.offsetBytes - cursor });
    }
    segments.push({ kind: "partition", ...partition });
    cursor = partition.offsetBytes + partition.sizeBytes;
  }
  if (cursor < disk.totalBytes) {
    segments.push({ kind: "unallocated", offsetBytes: cursor, sizeBytes: disk.totalBytes - cursor });
  }
  return segments;
}

api.registerSidebarPanel({
  id: "disk-partition-manager",
  title: "Disk Partition Manager",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "10px";
    container.style.fontSize = "12px";

    const mapContainer = document.createElement("div");
    mapContainer.style.display = "flex";
    mapContainer.style.flexDirection = "column";
    mapContainer.style.gap = "10px";

    const actionPanel = document.createElement("div");
    actionPanel.style.borderTop = "1px solid var(--border, #444)";
    actionPanel.style.paddingTop = "8px";
    actionPanel.style.display = "none";
    actionPanel.style.flexDirection = "column";
    actionPanel.style.gap = "6px";

    const status = document.createElement("p");
    status.style.margin = "0";
    status.style.color = "var(--fg-muted)";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    let disks = [];

    async function refresh() {
      try {
        disks = await api.listDisks();
        renderMap();
      } catch (error) {
        setStatus(String(error), true);
      }
    }

    function renderMap() {
      mapContainer.innerHTML = "";
      for (const disk of disks) {
        const label = document.createElement("div");
        label.style.fontWeight = "600";
        label.textContent = `Disk ${disk.number}${disk.isSystem ? " (System)" : ""} — ${disk.model} (${formatSize(disk.totalBytes)})`;
        mapContainer.appendChild(label);

        const bar = document.createElement("div");
        bar.style.display = "flex";
        bar.style.height = "40px";
        bar.style.borderRadius = "4px";
        bar.style.overflow = "hidden";
        bar.style.border = "1px solid var(--border, #444)";

        for (const segment of withUnallocatedGaps(disk)) {
          const cell = document.createElement("div");
          cell.style.flex = `0 0 ${Math.max(2, (segment.sizeBytes / disk.totalBytes) * 100)}%`;
          cell.style.display = "flex";
          cell.style.alignItems = "center";
          cell.style.justifyContent = "center";
          cell.style.fontSize = "10px";
          cell.style.color = "#fff";
          cell.style.cursor = "pointer";
          cell.style.borderRight = "1px solid var(--border, #333)";
          cell.title = `${formatSize(segment.sizeBytes)}`;

          if (segment.kind === "unallocated") {
            cell.style.background = "#2a2f36";
            cell.textContent = "Unallocated";
            cell.addEventListener("click", () => showNewPartitionPanel(disk, segment));
          } else {
            cell.style.background = disk.isSystem ? "#5b6472" : "#3b5f8a";
            cell.textContent = segment.driveLetter ?? "(no letter)";
            cell.addEventListener("click", () => showPartitionPanel(disk, segment));
          }

          bar.appendChild(cell);
        }

        mapContainer.appendChild(bar);
      }
    }

    function clearActionPanel() {
      actionPanel.style.display = "none";
      actionPanel.innerHTML = "";
    }

    function showPartitionPanel(disk, partition) {
      actionPanel.innerHTML = "";
      actionPanel.style.display = "flex";

      const heading = document.createElement("div");
      heading.style.fontWeight = "600";
      heading.textContent = `${partition.driveLetter ?? "(no letter)"} — ${formatSize(partition.sizeBytes)} — ${partition.filesystem ?? "unknown filesystem"}`;
      actionPanel.appendChild(heading);

      if (disk.isSystem) {
        const note = document.createElement("p");
        note.style.margin = "0";
        note.style.color = "var(--fg-muted)";
        note.textContent = "Not available on the system disk.";
        actionPanel.appendChild(note);
        return;
      }

      actionPanel.appendChild(
        buildTypedConfirmAction({
          label: "Delete Partition",
          confirmText: partition.driveLetter ?? "DELETE",
          run: () => api.deletePartition(disk.number, partition.driveLetter),
          successMessage: "Partition deleted.",
        }),
      );

      actionPanel.appendChild(
        buildTypedConfirmAction({
          label: "Format",
          confirmText: partition.driveLetter ?? "DELETE",
          run: () => api.formatPartition(disk.number, partition.driveLetter, "NTFS"),
          successMessage: "Partition formatted.",
        }),
      );

      const letterBtn = document.createElement("button");
      letterBtn.textContent = "Change Drive Letter…";
      letterBtn.addEventListener("click", async () => {
        const ok = await api.confirm(`Change the drive letter for ${partition.driveLetter}?`);
        if (!ok) return;
        const newLetter = window.prompt("New drive letter (leave blank to remove):", "");
        try {
          await api.setDriveLetter(disk.number, partition.driveLetter, newLetter ? `${newLetter}:` : undefined);
          setStatus("Drive letter updated.", false);
          await refresh();
        } catch (error) {
          setStatus(String(error), true);
        }
      });
      actionPanel.appendChild(letterBtn);
    }

    function showNewPartitionPanel(disk, gap) {
      actionPanel.innerHTML = "";
      actionPanel.style.display = "flex";

      const heading = document.createElement("div");
      heading.style.fontWeight = "600";
      heading.textContent = `Unallocated — ${formatSize(gap.sizeBytes)}`;
      actionPanel.appendChild(heading);

      if (disk.isSystem) {
        const note = document.createElement("p");
        note.style.margin = "0";
        note.style.color = "var(--fg-muted)";
        note.textContent = "Not available on the system disk.";
        actionPanel.appendChild(note);
        return;
      }

      const newBtn = document.createElement("button");
      newBtn.textContent = "New Partition…";
      newBtn.addEventListener("click", async () => {
        const ok = await api.confirm(`Create a new NTFS partition using all ${formatSize(gap.sizeBytes)} of unallocated space?`);
        if (!ok) return;
        try {
          await api.createPartition(disk.number, gap.offsetBytes, gap.sizeBytes, "NTFS");
          setStatus("Partition created.", false);
          clearActionPanel();
          await refresh();
        } catch (error) {
          setStatus(String(error), true);
        }
      });
      actionPanel.appendChild(newBtn);
    }

    function buildTypedConfirmAction({ label, confirmText, run, successMessage }) {
      const wrapper = document.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.flexDirection = "column";
      wrapper.style.gap = "4px";

      const hint = document.createElement("span");
      hint.style.fontSize = "11px";
      hint.style.color = "var(--fg-muted)";
      hint.textContent = `Type "${confirmText}" to enable`;

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = confirmText;

      const btn = document.createElement("button");
      btn.textContent = label;
      btn.disabled = true;

      input.addEventListener("input", () => {
        btn.disabled = input.value.trim().toUpperCase() !== confirmText.toUpperCase();
      });

      btn.addEventListener("click", async () => {
        btn.disabled = true;
        input.disabled = true;
        setStatus("Working… (approve the Administrator prompt if one appears)", false);
        try {
          await run();
          setStatus(successMessage, false);
          clearActionPanel();
          await refresh();
        } catch (error) {
          setStatus(String(error), true);
          input.disabled = false;
        }
      });

      wrapper.appendChild(hint);
      wrapper.appendChild(input);
      wrapper.appendChild(btn);
      return wrapper;
    }

    container.appendChild(mapContainer);
    container.appendChild(actionPanel);
    container.appendChild(status);

    void refresh();
  },
});
