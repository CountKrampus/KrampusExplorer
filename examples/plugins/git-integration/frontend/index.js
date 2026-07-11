// Entry point for the "Git Integration" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's
// built by createPluginApi() and only contains methods this plugin's manifest.json declared
// permission for (registerSidebarPanel: "ui.sidebar", getCurrentPath/onFolderChange:
// "nav.read", gitStatus/gitLog: "git.read").

api.registerSidebarPanel({
  id: "git-integration",
  title: "Git",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    const repoLabel = document.createElement("p");
    repoLabel.style.margin = "0";
    repoLabel.style.fontFamily = "monospace";
    repoLabel.style.fontSize = "11px";
    repoLabel.style.color = "var(--fg-muted)";
    repoLabel.style.wordBreak = "break-all";

    const status = document.createElement("p");
    status.style.margin = "0";
    status.style.color = "var(--danger, #d33)";

    const statusHeading = document.createElement("h4");
    statusHeading.textContent = "Status";
    statusHeading.style.margin = "8px 0 0 0";
    const statusList = document.createElement("div");
    statusList.style.fontFamily = "monospace";
    statusList.style.fontSize = "11px";
    statusList.style.whiteSpace = "pre";

    const logHeading = document.createElement("h4");
    logHeading.textContent = "Recent Commits";
    logHeading.style.margin = "8px 0 0 0";
    const logList = document.createElement("div");
    logList.style.fontFamily = "monospace";
    logList.style.fontSize = "11px";
    logList.style.whiteSpace = "pre";

    async function refresh(path) {
      if (!path) return;
      repoLabel.textContent = path;
      status.textContent = "";
      try {
        const [fileStatuses, commits] = await Promise.all([
          api.gitStatus(path),
          api.gitLog(path, 10),
        ]);
        statusList.textContent =
          fileStatuses.length > 0
            ? fileStatuses.map((f) => `${f.status} ${f.path}`).join("\n")
            : "Working tree clean";
        logList.textContent = commits
          .map((c) => `${c.hash.slice(0, 7)}  ${c.date}  ${c.author}\n  ${c.message}`)
          .join("\n");
      } catch (error) {
        statusList.textContent = "";
        logList.textContent = "";
        status.textContent = String(error);
      }
    }

    const currentPath = api.getCurrentPath?.();
    if (currentPath) refresh(currentPath);

    // Debounced: without this, quickly navigating through several folders (arrow keys,
    // double-click chains) would fire a `git status` + `git log` subprocess pair for every
    // folder passed through, not just the one the user lands on.
    let debounceTimer = null;
    const unsubscribe = api.onFolderChange?.((path) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => refresh(path), 300);
    });

    container.appendChild(repoLabel);
    container.appendChild(status);
    container.appendChild(statusHeading);
    container.appendChild(statusList);
    container.appendChild(logHeading);
    container.appendChild(logList);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe?.();
    };
  },
});
