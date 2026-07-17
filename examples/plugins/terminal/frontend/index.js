// Entry point for the "Terminal" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's
// built by createPluginApi() and only contains methods this plugin's manifest.json declared
// permission for (registerSidebarPanel: "ui.sidebar", getCurrentPath/onFolderChange:
// "nav.read", openTerminal: "ui.terminal").
//
// The actual terminal — PTY sessions, xterm.js rendering, tabs — lives in the core app's own
// detached window, not in this sandboxed plugin. Opening a whole new OS window with raw shell
// access is a bigger capability than the plugin sandbox grants anything else; this plugin is
// just the trigger button. See docs/plugins.md's "Terminal window" section.

api.registerSidebarPanel({
  id: "terminal",
  title: "Terminal",
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

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open Terminal";
    openBtn.style.cursor = "pointer";
    openBtn.addEventListener("click", () => {
      api.openTerminal();
    });

    const openAdminBtn = document.createElement("button");
    openAdminBtn.textContent = "Open Terminal (Admin)";
    openAdminBtn.style.cursor = "pointer";
    openAdminBtn.addEventListener("click", () => {
      api.openElevatedTerminal();
    });

    container.appendChild(cwdLabel);
    container.appendChild(openBtn);
    container.appendChild(openAdminBtn);

    return () => {
      unsubscribe?.();
    };
  },
});
