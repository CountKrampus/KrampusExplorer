// Entry point for the "Run Command" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's
// built by createPluginApi() and only contains methods this plugin's manifest.json declared
// permission for (registerSidebarPanel: "ui.sidebar", getCurrentPath/onFolderChange:
// "nav.read", runCommand: "system.exec").
//
// This is a deliberately scoped-down "Terminal" — one command in, stdout/stderr out, no
// interactive shell, no persistent session. runCommand executes with the app's own OS
// permissions and no sandboxing; only grant "system.exec" to plugins you trust completely.

api.registerSidebarPanel({
  id: "run-command",
  title: "Run Command",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const cwdLabel = document.createElement("p");
    cwdLabel.style.margin = "0";
    cwdLabel.style.fontFamily = "monospace";
    cwdLabel.style.fontSize = "11px";
    cwdLabel.style.color = "var(--fg-muted)";
    cwdLabel.style.wordBreak = "break-all";

    let cwd = api.getCurrentPath?.() ?? "";
    cwdLabel.textContent = cwd || "(no folder open)";

    const unsubscribe = api.onFolderChange?.((path) => {
      cwd = path;
      cwdLabel.textContent = path;
    });

    const inputRow = document.createElement("div");
    inputRow.style.display = "flex";
    inputRow.style.gap = "6px";

    const commandInput = document.createElement("input");
    commandInput.type = "text";
    commandInput.placeholder = "Command to run in the folder above";
    commandInput.style.flex = "1";
    commandInput.style.padding = "4px 6px";
    commandInput.style.fontFamily = "monospace";

    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cursor = "pointer";

    inputRow.appendChild(commandInput);
    inputRow.appendChild(runBtn);

    const exitLabel = document.createElement("p");
    exitLabel.style.margin = "0";

    const output = document.createElement("div");
    output.style.fontFamily = "monospace";
    output.style.fontSize = "11px";
    output.style.whiteSpace = "pre-wrap";
    output.style.wordBreak = "break-all";
    output.style.maxHeight = "260px";
    output.style.overflowY = "auto";

    async function run() {
      const command = commandInput.value.trim();
      if (!command || !cwd) return;
      runBtn.disabled = true;
      exitLabel.textContent = "Running...";
      exitLabel.style.color = "var(--fg-muted)";
      try {
        const result = await api.runCommand(cwd, command);
        exitLabel.textContent = `Exit code: ${result.exitCode}`;
        exitLabel.style.color = result.exitCode === 0 ? "var(--fg-muted)" : "var(--danger, #d33)";
        output.textContent = [result.stdout, result.stderr].filter(Boolean).join("\n");
      } catch (error) {
        exitLabel.textContent = "Failed to run command";
        exitLabel.style.color = "var(--danger, #d33)";
        output.textContent = String(error);
      } finally {
        runBtn.disabled = false;
      }
    }

    runBtn.addEventListener("click", run);
    commandInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") run();
    });

    container.appendChild(cwdLabel);
    container.appendChild(inputRow);
    container.appendChild(exitLabel);
    container.appendChild(output);

    return () => {
      unsubscribe?.();
    };
  },
});
