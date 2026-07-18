// Entry point for the "Drive Format" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", listDrives: "system.drives", getSystemDrive/
// formatDrive: "fs.format", confirm: "ui.confirm").
//
// This plugin does NOT implement formatting itself -- formatDrive() opens Windows' own native
// Format dialog. Everything here is about safely getting to that point: excluding the system
// drive from the picker, and one explicit confirmation before the native dialog appears.

function formatSize(bytes) {
  if (bytes === null) return "unknown size";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

api.registerSidebarPanel({
  id: "drive-format",
  title: "Drive Format",
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
    warning.textContent = "Formatting permanently erases everything on a drive. This cannot be undone.";

    const driveSelect = document.createElement("select");
    driveSelect.style.padding = "4px 6px";
    driveSelect.style.fontSize = "12px";

    const formatBtn = document.createElement("button");
    formatBtn.textContent = "Format Drive…";
    formatBtn.style.padding = "5px 10px";
    formatBtn.style.fontSize = "12px";
    formatBtn.style.cursor = "pointer";
    formatBtn.disabled = true;

    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    let drives = [];

    function selectedDrive() {
      return drives.find((d) => d.name === driveSelect.value) ?? null;
    }

    async function loadDrives() {
      try {
        const [allDrives, systemDrive] = await Promise.all([api.listDrives(), api.getSystemDrive()]);
        const normalizedSystemDrive = systemDrive?.replace(/\\$/, "").toUpperCase() ?? null;
        drives = allDrives.filter((d) => d.name.toUpperCase() !== normalizedSystemDrive);

        driveSelect.innerHTML = "";
        if (drives.length === 0) {
          setStatus("No non-system drives found.", false);
          formatBtn.disabled = true;
          return;
        }
        for (const drive of drives) {
          const option = document.createElement("option");
          option.value = drive.name;
          option.textContent = `${drive.name} (${formatSize(drive.totalBytes)})`;
          driveSelect.appendChild(option);
        }
        formatBtn.disabled = false;
        setStatus("", false);
      } catch (error) {
        setStatus(String(error), true);
      }
    }

    formatBtn.addEventListener("click", async () => {
      const drive = selectedDrive();
      if (!drive) {
        setStatus("Select a drive to format.", true);
        return;
      }

      const ok = await api.confirm(
        `This will PERMANENTLY ERASE ALL DATA on drive ${drive.name} (${formatSize(drive.totalBytes)}). ` +
          `This cannot be undone. Continue?`,
      );
      if (!ok) return;

      formatBtn.disabled = true;
      setStatus("Waiting for the Format dialog…", false);
      try {
        const outcome = await api.formatDrive(drive.name);
        if (outcome === "formatted") {
          setStatus(`Drive ${drive.name} was formatted.`, false);
        } else if (outcome === "cancelled") {
          setStatus("Format cancelled.", false);
        } else {
          setStatus(`Drive ${drive.name} can't be formatted.`, true);
        }
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        formatBtn.disabled = false;
      }
    });

    container.appendChild(warning);
    container.appendChild(driveSelect);
    container.appendChild(formatBtn);
    container.appendChild(status);

    void loadDrives();
  },
});
