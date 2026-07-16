// Entry point for the "Checksum Verifier" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's built
// by createPluginApi() and only contains methods this plugin's manifest.json declared permission
// for (registerSidebarPanel: "ui.sidebar", getSelectedPath/onSelectionChange: "nav.read",
// copyToClipboard: "clipboard.write", hashFileAll: "fs.scan").

api.registerSidebarPanel({
  id: "checksum-verifier",
  title: "Checksum Verifier",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const pathInput = document.createElement("input");
    pathInput.type = "text";
    pathInput.placeholder = "File to check";
    pathInput.value = api.getSelectedPath?.() ?? "";
    pathInput.style.padding = "4px 6px";
    pathInput.style.fontSize = "12px";

    const computeBtn = document.createElement("button");
    computeBtn.textContent = "Compute Hashes";
    computeBtn.style.padding = "5px 10px";
    computeBtn.style.fontSize = "12px";
    computeBtn.style.cursor = "pointer";

    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    status.style.minHeight = "14px";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    let currentHashes = null; // { md5, sha1, sha256 } once computed

    const compareLabel = document.createElement("span");
    compareLabel.textContent = "Compare against";
    const compareInput = document.createElement("input");
    compareInput.type = "text";
    compareInput.placeholder = "Paste a published checksum here";
    compareInput.style.padding = "4px 6px";
    compareInput.style.fontSize = "12px";

    const compareResult = document.createElement("p");
    compareResult.style.margin = "0";
    compareResult.style.minHeight = "14px";
    compareResult.style.fontWeight = "600";

    function updateCompareResult() {
      const expected = compareInput.value.trim().toLowerCase();
      if (!expected || !currentHashes) {
        compareResult.textContent = "";
        return;
      }
      const match = Object.entries(currentHashes).find(([, value]) => value === expected);
      if (match) {
        compareResult.textContent = `Match (${match[0].toUpperCase()})`;
        compareResult.style.color = "var(--accent)";
      } else {
        compareResult.textContent = "No match";
        compareResult.style.color = "var(--danger, #d33)";
      }
    }
    compareInput.addEventListener("input", updateCompareResult);

    const hashRows = document.createElement("div");
    hashRows.style.display = "flex";
    hashRows.style.flexDirection = "column";
    hashRows.style.gap = "6px";

    function renderHashRow(label, value) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.flexDirection = "column";
      row.style.gap = "2px";

      const labelRow = document.createElement("div");
      labelRow.style.display = "flex";
      labelRow.style.justifyContent = "space-between";
      labelRow.style.alignItems = "center";

      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      labelSpan.style.fontWeight = "600";
      labelSpan.style.color = "var(--fg-muted)";

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy";
      copyBtn.style.fontSize = "11px";
      copyBtn.style.padding = "2px 6px";
      copyBtn.style.cursor = "pointer";
      copyBtn.addEventListener("click", async () => {
        try {
          await api.copyToClipboard(value);
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
          }, 1200);
        } catch (error) {
          setStatus(String(error), true);
        }
      });

      labelRow.appendChild(labelSpan);
      labelRow.appendChild(copyBtn);

      const valueSpan = document.createElement("div");
      valueSpan.textContent = value;
      valueSpan.style.fontFamily = "ui-monospace, Consolas, monospace";
      valueSpan.style.wordBreak = "break-all";
      valueSpan.style.color = "var(--fg)";

      row.appendChild(labelRow);
      row.appendChild(valueSpan);
      return row;
    }

    computeBtn.addEventListener("click", async () => {
      const path = pathInput.value.trim();
      if (!path) {
        setStatus("Enter a file path.", true);
        return;
      }
      computeBtn.disabled = true;
      hashRows.innerHTML = "";
      currentHashes = null;
      setStatus("Computing…", false);
      try {
        const hashes = await api.hashFileAll(path);
        currentHashes = hashes;
        hashRows.appendChild(renderHashRow("MD5", hashes.md5));
        hashRows.appendChild(renderHashRow("SHA-1", hashes.sha1));
        hashRows.appendChild(renderHashRow("SHA-256", hashes.sha256));
        setStatus("", false);
        updateCompareResult();
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        computeBtn.disabled = false;
      }
    });

    const unsubscribe = api.onSelectionChange?.((path) => {
      if (path) pathInput.value = path;
    });

    container.appendChild(pathInput);
    container.appendChild(computeBtn);
    container.appendChild(status);
    container.appendChild(hashRows);
    container.appendChild(compareLabel);
    container.appendChild(compareInput);
    container.appendChild(compareResult);

    return () => {
      unsubscribe?.();
    };
  },
});
