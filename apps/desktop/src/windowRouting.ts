/** True when `label` is the detached terminal window's label ("terminal", set on the Rust side
 * by `open_terminal_window`), false for the main explorer window. Read once at startup in
 * `main.tsx` (via `getCurrentWindow().label`) to pick which React root to render — each Tauri
 * window loads the same `index.html`/`main.tsx` bundle. Routes on the window label rather than
 * a URL query string because `WebviewUrl::App` takes a filesystem `PathBuf`, not a URL, so a
 * `?query=string` appended to it isn't reliably visible to `window.location.search`. */
export function isTerminalWindow(label: string): boolean {
  return label === "terminal";
}
