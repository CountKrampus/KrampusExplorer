// Entry point for the "Archive Manager" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's
// built by createPluginApi() and only contains methods this plugin's manifest.json declared
// permission for (registerSidebarPanel: "ui.sidebar", getSelectedPath/getCurrentPath:
// "nav.read", createZipArchive/extractZipArchive: "fs.archive").

api.registerSidebarPanel({
  id: "archive-manager",
  title: "Archive Manager",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "10px";
    container.style.fontSize = "12px";

    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

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

    function button(text, onClick) {
      const btn = document.createElement("button");
      btn.textContent = text;
      btn.style.padding = "5px 10px";
      btn.style.fontSize = "12px";
      btn.style.cursor = "pointer";
      btn.addEventListener("click", onClick);
      return btn;
    }

    // --- Compress ---
    const compressHeading = document.createElement("h4");
    compressHeading.textContent = "Compress";
    compressHeading.style.margin = "0";

    const sourceInput = document.createElement("input");
    sourceInput.type = "text";
    sourceInput.placeholder = "File or folder to compress";
    sourceInput.value = api.getSelectedPath?.() ?? "";

    const zipDestInput = document.createElement("input");
    zipDestInput.type = "text";
    zipDestInput.placeholder = "Destination .zip path";

    const compressBtn = button("Create Archive", async () => {
      const source = sourceInput.value.trim();
      const dest = zipDestInput.value.trim();
      if (!source || !dest) {
        setStatus("Enter a source and destination path.", true);
        return;
      }
      try {
        const result = await api.createZipArchive([source], dest);
        setStatus(`Created ${result}`, false);
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    // --- Extract ---
    const extractHeading = document.createElement("h4");
    extractHeading.textContent = "Extract";
    extractHeading.style.margin = "8px 0 0 0";

    const zipSourceInput = document.createElement("input");
    zipSourceInput.type = "text";
    zipSourceInput.placeholder = ".zip file to extract";
    zipSourceInput.value = api.getSelectedPath?.() ?? "";

    const extractDestInput = document.createElement("input");
    extractDestInput.type = "text";
    extractDestInput.placeholder = "Destination folder";

    const extractBtn = button("Extract Archive", async () => {
      const source = zipSourceInput.value.trim();
      const dest = extractDestInput.value.trim();
      if (!source || !dest) {
        setStatus("Enter a source and destination path.", true);
        return;
      }
      try {
        const result = await api.extractZipArchive(source, dest);
        setStatus(`Extracted to ${result}`, false);
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    const unsubscribe = api.onSelectionChange?.((path) => {
      if (path) {
        sourceInput.value = path;
        zipSourceInput.value = path;
      }
    });

    container.appendChild(compressHeading);
    container.appendChild(labeled("Source", sourceInput));
    container.appendChild(labeled("Destination archive", zipDestInput));
    container.appendChild(compressBtn);
    container.appendChild(extractHeading);
    container.appendChild(labeled("Archive", zipSourceInput));
    container.appendChild(labeled("Destination folder", extractDestInput));
    container.appendChild(extractBtn);
    container.appendChild(status);

    return () => {
      unsubscribe?.();
    };
  },
});
