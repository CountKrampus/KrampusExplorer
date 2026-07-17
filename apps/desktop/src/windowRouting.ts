/** True when this webview was opened as the detached terminal window (`?window=terminal`),
 * false for the main explorer window. Read once at startup in `main.tsx` to pick which React
 * root to render — each Tauri window loads the same `index.html`/`main.tsx` bundle. */
export function isTerminalWindow(search: string): boolean {
  return new URLSearchParams(search).get("window") === "terminal";
}
