// Entry point for the "Archive Manager" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's
// built by createPluginApi() and only contains methods this plugin's manifest.json declared
// permission for (registerSidebarPanel: "ui.sidebar", registerContextMenuItem:
// "ui.contextMenu", getSelectedPath/getCurrentPath: "nav.read", createZipArchive/
// extractZipArchive: "fs.archive", registerCommand: "commands.register").

function basename(path) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

api.registerCommand?.({
  id: "compress-selected",
  label: "Compress Selected to .zip",
  run: () => {
    const path = api.getSelectedPath?.();
    if (!path) {
      window.alert("Select a file or folder first.");
      return;
    }
    api.createZipArchive([path], `${path}.zip`).catch((error) => window.alert(String(error)));
  },
});

// Both entries show up in the context menu for every file/folder — there's no API yet to hide
// an item based on what was right-clicked, so each onClick early-returns (silently, no error)
// when it doesn't apply to the clicked entry. Compare: the sidebar panel above doesn't validate
// its source is really an archive before extracting either — the backend's own error surfaces.
api.registerContextMenuItem?.({
  id: "compress-folder",
  label: "Compress to .zip",
  onClick: async (path, isDir) => {
    if (!isDir) {
      window.alert("Only folders can be compressed from the context menu — use the sidebar panel for individual files.");
      return;
    }
    const destZipPath = `${path}.zip`;
    try {
      await api.createZipArchive([path], destZipPath);
    } catch (error) {
      window.alert(String(error));
    }
  },
});

api.registerContextMenuItem?.({
  id: "extract-here",
  label: "Extract Here",
  onClick: async (path, isDir) => {
    if (isDir || !path.toLowerCase().endsWith(".zip")) return;
    const parent = path.slice(0, path.length - basename(path).length - 1);
    const destDir = `${parent}\\${basename(path).replace(/\.zip$/i, "")}`;
    try {
      await api.extractZipArchive(path, destDir);
    } catch (error) {
      window.alert(String(error));
    }
  },
});

api.registerSidebarPanel({
  id: "archive-manager",
  title: "Archive Manager",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    function labeled(labelText, input) {
      const wrapper = document.createElement("label");
      wrapper.style.display = "flex";
      wrapper.style.flexDirection = "column";
      wrapper.style.gap = "4px";
      const span = document.createElement("span");
      span.textContent = labelText;
      input.style.padding = "4px 6px";
      input.style.fontSize = "12px";
      wrapper.appendChild(span);
      wrapper.appendChild(input);
      return wrapper;
    }

    // --- Mode toggle: one shared Source/Destination pair, the action switches with the mode ---
    const modeRow = document.createElement("div");
    modeRow.style.display = "flex";
    modeRow.style.gap = "10px";

    let mode = "compress";
    const compressRadio = document.createElement("label");
    const compressModeInput = document.createElement("input");
    compressModeInput.type = "radio";
    compressModeInput.name = "archive-manager-mode";
    compressModeInput.checked = true;
    compressRadio.appendChild(compressModeInput);
    compressRadio.appendChild(document.createTextNode(" Compress"));

    const extractRadio = document.createElement("label");
    const extractModeInput = document.createElement("input");
    extractModeInput.type = "radio";
    extractModeInput.name = "archive-manager-mode";
    extractRadio.appendChild(extractModeInput);
    extractRadio.appendChild(document.createTextNode(" Extract"));

    modeRow.appendChild(compressRadio);
    modeRow.appendChild(extractRadio);

    const sourceInput = document.createElement("input");
    sourceInput.type = "text";
    sourceInput.placeholder = "File or folder to compress";
    sourceInput.value = api.getSelectedPath?.() ?? "";
    const sourceField = labeled("Source", sourceInput);

    const destInput = document.createElement("input");
    destInput.type = "text";
    destInput.placeholder = "Destination .zip path";
    const destField = labeled("Destination", destInput);

    const runBtn = document.createElement("button");
    runBtn.style.padding = "5px 10px";
    runBtn.style.fontSize = "12px";
    runBtn.style.cursor = "pointer";

    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    function applyMode() {
      if (mode === "compress") {
        sourceInput.placeholder = "File or folder to compress";
        destInput.placeholder = "Destination .zip path";
        sourceField.firstChild.textContent = "Source";
        destField.firstChild.textContent = "Destination archive";
        runBtn.textContent = "Create Archive";
      } else {
        sourceInput.placeholder = ".zip file to extract";
        destInput.placeholder = "Destination folder";
        sourceField.firstChild.textContent = "Archive";
        destField.firstChild.textContent = "Destination folder";
        runBtn.textContent = "Extract Archive";
      }
      setStatus("", false);
    }

    compressModeInput.addEventListener("change", () => {
      mode = "compress";
      applyMode();
    });
    extractModeInput.addEventListener("change", () => {
      mode = "extract";
      applyMode();
    });

    runBtn.addEventListener("click", async () => {
      const source = sourceInput.value.trim();
      const dest = destInput.value.trim();
      if (!source || !dest) {
        setStatus("Enter a source and destination path.", true);
        return;
      }
      try {
        if (mode === "compress") {
          const result = await api.createZipArchive([source], dest);
          setStatus(`Created ${result}`, false);
        } else {
          const result = await api.extractZipArchive(source, dest);
          setStatus(`Extracted to ${result}`, false);
        }
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    const unsubscribe = api.onSelectionChange?.((path) => {
      if (path) sourceInput.value = path;
    });

    applyMode();

    container.appendChild(modeRow);
    container.appendChild(sourceField);
    container.appendChild(destField);
    container.appendChild(runBtn);
    container.appendChild(status);

    return () => {
      unsubscribe?.();
    };
  },
});
