// Entry point for the "Recover Lost Data" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", listDrives: "system.drives", startRecoveryScan/
// getRecoveryProgress: "fs.recover", confirm: "ui.confirm", getCurrentPath: "nav.read").

const FILE_TYPES = [
  { id: "jpeg", label: "JPEG images" },
  { id: "png", label: "PNG images" },
  { id: "pdf", label: "PDF documents" },
  { id: "zip", label: "ZIP archives (also covers DOCX/XLSX/PPTX)" },
  { id: "mp3", label: "MP3 audio" },
];

// A deliberately conservative assumed raw-read speed for the duration estimate -- this is a
// rough heuristic, not a measurement, so it's labeled as approximate in the UI rather than
// implying precision the app can't actually provide without probing the real device.
const ASSUMED_READ_SPEED_MB_PER_SEC = 50;

const POLL_INTERVAL_MS = 1000;

function formatSize(bytes) {
  if (bytes === null) return "unknown size";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function estimateDurationLabel(totalBytes) {
  if (!totalBytes) return "";
  const seconds = totalBytes / (ASSUMED_READ_SPEED_MB_PER_SEC * 1024 * 1024);
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `~${minutes} minute${minutes === 1 ? "" : "s"} (actual time depends on your drive's speed)`;
}

api.registerSidebarPanel({
  id: "recover-lost-data",
  title: "Recover Lost Data",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const driveSelect = document.createElement("select");
    driveSelect.style.padding = "4px 6px";
    driveSelect.style.fontSize = "12px";

    const durationLabel = document.createElement("p");
    durationLabel.style.color = "var(--fg-muted)";
    durationLabel.style.margin = "0";
    durationLabel.style.fontSize = "11px";

    const typesContainer = document.createElement("div");
    typesContainer.style.display = "flex";
    typesContainer.style.flexDirection = "column";
    typesContainer.style.gap = "2px";
    const typeCheckboxes = new Map();
    for (const type of FILE_TYPES) {
      const label = document.createElement("label");
      label.style.display = "flex";
      label.style.alignItems = "center";
      label.style.gap = "6px";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      typeCheckboxes.set(type.id, checkbox);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(type.label));
      typesContainer.appendChild(label);
    }

    const destInput = document.createElement("input");
    destInput.type = "text";
    destInput.placeholder = "Destination folder for recovered files";
    destInput.value = api.getCurrentPath?.() ?? "";
    destInput.style.padding = "4px 6px";
    destInput.style.fontSize = "12px";

    const startBtn = document.createElement("button");
    startBtn.textContent = "Start Scan";
    startBtn.style.padding = "5px 10px";
    startBtn.style.fontSize = "12px";
    startBtn.style.cursor = "pointer";

    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    let drives = [];
    let pollHandle = null;

    function selectedDrive() {
      return drives.find((d) => d.name === driveSelect.value) ?? null;
    }

    function updateDurationLabel() {
      const drive = selectedDrive();
      durationLabel.textContent = drive ? estimateDurationLabel(drive.totalBytes) : "";
    }

    async function loadDrives() {
      try {
        drives = await api.listDrives();
        driveSelect.innerHTML = "";
        for (const drive of drives) {
          const option = document.createElement("option");
          option.value = drive.name;
          option.textContent = `${drive.name} (${formatSize(drive.totalBytes)})`;
          driveSelect.appendChild(option);
        }
        updateDurationLabel();
      } catch (error) {
        setStatus(String(error), true);
      }
    }

    driveSelect.addEventListener("change", updateDurationLabel);

    function stopPolling() {
      if (pollHandle !== null) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    }

    function summarizeFilesFound(filesFoundByType) {
      const parts = Object.entries(filesFoundByType)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => `${count} ${type}`);
      return parts.length > 0 ? parts.join(", ") : "none";
    }

    function pollProgress(scanId) {
      pollHandle = setInterval(async () => {
        let progress;
        try {
          progress = await api.getRecoveryProgress(scanId);
        } catch {
          // The elevated process may not have written its first progress update yet --
          // tolerate this rather than treating it as a fatal error.
          return;
        }

        const percent =
          progress.totalBytes > 0
            ? Math.min(100, Math.round((progress.bytesScanned / progress.totalBytes) * 100))
            : 0;

        if (progress.status === "running") {
          setStatus(
            `Scanning… ${percent}% (${summarizeFilesFound(progress.filesFoundByType)} found so far)`,
            false,
          );
        } else if (progress.status === "completed") {
          stopPolling();
          startBtn.disabled = false;
          setStatus(
            `Done. Recovered: ${summarizeFilesFound(progress.filesFoundByType)} -- saved to ${destInput.value}`,
            false,
          );
        } else if (progress.status === "failed") {
          stopPolling();
          startBtn.disabled = false;
          setStatus(progress.error ?? "Recovery scan failed.", true);
        }
      }, POLL_INTERVAL_MS);
    }

    startBtn.addEventListener("click", async () => {
      const drive = selectedDrive();
      if (!drive) {
        setStatus("Select a drive to scan.", true);
        return;
      }
      const destination = destInput.value.trim();
      if (!destination) {
        setStatus("Enter a destination folder for recovered files.", true);
        return;
      }
      const fileTypes = FILE_TYPES.filter((t) => typeCheckboxes.get(t.id)?.checked).map((t) => t.id);
      if (fileTypes.length === 0) {
        setStatus("Select at least one file type.", true);
        return;
      }

      const duration = estimateDurationLabel(drive.totalBytes);
      const ok = await api.confirm(
        `Scan ${drive.name} for recoverable files? This requires Administrator access and will ` +
          `take ${duration}. Recovered files will be saved to ${destination}.`,
      );
      if (!ok) return;

      startBtn.disabled = true;
      setStatus("Starting… (approve the Administrator prompt if one appears)", false);
      try {
        const scanId = await api.startRecoveryScan(drive.name, destination, fileTypes);
        pollProgress(scanId);
      } catch (error) {
        startBtn.disabled = false;
        setStatus(String(error), true);
      }
    });

    container.appendChild(driveSelect);
    container.appendChild(durationLabel);
    container.appendChild(typesContainer);
    container.appendChild(destInput);
    container.appendChild(startBtn);
    container.appendChild(status);

    void loadDrives();

    return () => {
      stopPolling();
    };
  },
});
