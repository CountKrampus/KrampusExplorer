// Entry point for the "Secure Wipe" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", listDrives: "system.drives", getSystemDrive:
// "fs.format", startSecureWipe/getWipeProgress: "fs.wipe").
//
// Unlike Drive Format, there is no native OS dialog backstopping this action -- this plugin's
// own typed-drive-letter confirmation IS the real safety gate, so there's no separate
// api.confirm() step here.

const POLL_INTERVAL_MS = 1000;

function formatSize(bytes) {
  if (bytes === null) return "unknown size";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

api.registerSidebarPanel({
  id: "secure-wipe",
  title: "Secure Wipe",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const warning = document.createElement("p");
    warning.style.margin = "0";
    warning.style.color = "var(--danger, #d33)";
    warning.style.fontWeight = "600";
    warning.textContent =
      "Securely erases a drive with a single zero-fill pass. This cannot be undone. " +
      "On SSDs, wear-leveling means this cannot guarantee the old data is truly unrecoverable -- " +
      "for guaranteed SSD erasure, use the drive manufacturer's own secure-erase tool.";

    const driveSelect = document.createElement("select");
    driveSelect.style.padding = "4px 6px";
    driveSelect.style.fontSize = "12px";

    const confirmLabel = document.createElement("label");
    confirmLabel.style.display = "flex";
    confirmLabel.style.flexDirection = "column";
    confirmLabel.style.gap = "2px";
    confirmLabel.style.fontSize = "11px";
    confirmLabel.style.color = "var(--fg-muted)";

    const confirmInput = document.createElement("input");
    confirmInput.type = "text";
    confirmInput.style.padding = "4px 6px";
    confirmInput.style.fontSize = "12px";
    confirmInput.placeholder = "Type the drive letter to confirm";

    const wipeBtn = document.createElement("button");
    wipeBtn.textContent = "Securely Wipe Drive";
    wipeBtn.style.padding = "5px 10px";
    wipeBtn.style.fontSize = "12px";
    wipeBtn.style.cursor = "pointer";
    wipeBtn.disabled = true;

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

    function updateConfirmLabel() {
      const drive = selectedDrive();
      confirmLabel.textContent = drive ? `Type "${drive.name}" to confirm` : "";
    }

    function updateWipeButton() {
      const drive = selectedDrive();
      const typed = confirmInput.value.trim().toUpperCase();
      wipeBtn.disabled = !drive || typed !== drive.name.toUpperCase();
    }

    async function loadDrives() {
      try {
        const [allDrives, systemDrive] = await Promise.all([api.listDrives(), api.getSystemDrive()]);
        const normalizedSystemDrive = systemDrive?.replace(/\\$/, "").toUpperCase() ?? null;
        drives = allDrives.filter((d) => d.name.toUpperCase() !== normalizedSystemDrive);

        driveSelect.innerHTML = "";
        if (drives.length === 0) {
          setStatus("No non-system drives found.", false);
          return;
        }
        for (const drive of drives) {
          const option = document.createElement("option");
          option.value = drive.name;
          option.textContent = `${drive.name} (${formatSize(drive.totalBytes)})`;
          driveSelect.appendChild(option);
        }
        updateConfirmLabel();
        updateWipeButton();
        setStatus("", false);
      } catch (error) {
        setStatus(String(error), true);
      }
    }

    driveSelect.addEventListener("change", () => {
      confirmInput.value = "";
      updateConfirmLabel();
      updateWipeButton();
    });
    confirmInput.addEventListener("input", updateWipeButton);

    function stopPolling() {
      if (pollHandle !== null) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    }

    function pollProgress(wipeId, driveName) {
      pollHandle = setInterval(async () => {
        let progress;
        try {
          progress = await api.getWipeProgress(wipeId);
        } catch {
          // The elevated process may not have written its first progress update yet --
          // tolerate this rather than treating it as a fatal error.
          return;
        }

        const percent =
          progress.totalBytes > 0
            ? Math.min(100, Math.round((progress.bytesWritten / progress.totalBytes) * 100))
            : 0;

        if (progress.status === "running") {
          setStatus(`Wiping… ${percent}%`, false);
        } else if (progress.status === "completed") {
          stopPolling();
          setStatus(`Drive ${driveName} was securely wiped.`, false);
        } else if (progress.status === "failed") {
          stopPolling();
          setStatus(progress.error ?? "Secure wipe failed.", true);
        }
      }, POLL_INTERVAL_MS);
    }

    wipeBtn.addEventListener("click", async () => {
      const drive = selectedDrive();
      if (!drive) return;

      wipeBtn.disabled = true;
      driveSelect.disabled = true;
      confirmInput.disabled = true;
      setStatus("Starting… (approve the Administrator prompt if one appears)", false);
      try {
        const wipeId = await api.startSecureWipe(drive.name);
        pollProgress(wipeId, drive.name);
      } catch (error) {
        setStatus(String(error), true);
        driveSelect.disabled = false;
        confirmInput.disabled = false;
        updateWipeButton();
      }
    });

    container.appendChild(warning);
    container.appendChild(driveSelect);
    confirmLabel.appendChild(confirmInput);
    container.appendChild(confirmLabel);
    container.appendChild(wipeBtn);
    container.appendChild(status);

    void loadDrives();

    return () => {
      stopPolling();
    };
  },
});
