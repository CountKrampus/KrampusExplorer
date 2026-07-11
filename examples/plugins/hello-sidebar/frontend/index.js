// Entry point for the "Hello Sidebar" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's
// built by createPluginApi() and only contains methods this plugin's manifest.json declared
// permission for (registerSidebarPanel requires the "ui.sidebar" permission).

api.registerSidebarPanel({
  id: "hello",
  title: "Hello Plugin",
  render(container) {
    const message = document.createElement("p");
    message.textContent = "Hello from a plugin! This panel was registered by the hello-sidebar example.";
    message.style.padding = "4px 12px";
    message.style.fontSize = "12px";
    message.style.color = "var(--fg-muted)";
    container.appendChild(message);

    // Optional: return a cleanup function, called when the panel is torn down.
    return () => {
      container.removeChild(message);
    };
  },
});
