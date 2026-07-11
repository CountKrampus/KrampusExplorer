# Plugin SDK (v1)

Status: early. This covers what's actually implemented, not the full plugin capability list in
`Plan.md`. See "Not yet implemented" below for what's deferred.

## Installing a plugin

Plugins live in a directory scanned on every app launch:

- Windows: `%APPDATA%\Krampus Explorer\plugins\`

Each plugin is a subdirectory containing a `manifest.json` and an entry JS file. Drop a plugin
folder in, restart the app — it'll show up in Settings → Plugins (or a load error will, if
something's wrong).

See `examples/plugins/hello-sidebar/` for a working minimal example.

## manifest.json

```json
{
  "id": "hello-sidebar",
  "name": "Hello Sidebar",
  "version": "1.0.0",
  "author": "Someone",
  "permissions": ["ui.sidebar"],
  "entry": "frontend/index.js"
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique. Used as the key for registered panels and load-error reporting. |
| `name` | yes | Display name (shown in Settings → Plugins). |
| `version` | yes | Free-form string, not currently validated as semver. |
| `author` | yes | Display string. |
| `permissions` | no (defaults to `[]`) | See Permissions below. |
| `entry` | yes | Path to the JS entry file, relative to the plugin's own directory. Must exist, or the whole manifest is skipped. |

Manifests with invalid JSON, missing required fields, or a missing `entry` file are silently
skipped — they won't crash the app or block other plugins from loading, but they also won't
appear anywhere (not even as an error) since the backend can't identify a broken plugin well
enough to report on it meaningfully. If your plugin isn't showing up, check `manifest.json` is
valid JSON with all required fields first.

## Permissions and the `api` object

A plugin's entry file runs with one variable in scope: `api`. It only contains the methods your
manifest's `permissions` array actually grants — there's no runtime permission check on each
call, because ungranted methods simply don't exist on the object.

| Permission | Grants |
|---|---|
| `ui.sidebar` | `api.registerSidebarPanel(panel)` |

### `registerSidebarPanel`

```ts
api.registerSidebarPanel({
  id: string,           // unique within this plugin
  title: string,        // shown as the panel's heading in the sidebar
  render(container: HTMLElement): void | (() => void),
});
```

`render` receives an empty `<div>` to fill in with plain DOM APIs (`document.createElement`,
etc.) — not React or any framework. It may optionally return a cleanup function, called if the
panel is ever torn down.

CSS custom properties from the app's theme (`--bg`, `--fg`, `--fg-muted`, `--border`, `--accent`,
`--danger`) are available to style against, same as the rest of the app.

## How entry files execute — and why this matters

An entry file is loaded as plain text via IPC and run through `new Function("api", code)` — it is
**not** an ES module (no `import`/`export`) and it is **not** sandboxed. Two consequences:

1. **Only plain scripts, no `import`/`export`.** If you need dependencies, bundle them into the
   single entry file yourself (e.g. with esbuild) before shipping the plugin.
2. **Permission gating is not a security boundary.** `new Function` executes with access to the
   full global scope (`window`, `document`, `fetch`, and anything else a webview exposes) — a
   plugin isn't limited to whatever's on `api` if it goes looking for globals directly.
   `permissions` controls the *documented, supported* surface; it doesn't stop malicious code.
   Only install plugins you trust. Real sandboxing (e.g. running plugin code in a restricted Web
   Worker with a message-passed API instead of directly-shared globals) is future hardening, not
   part of this pass.

This design was a deliberate choice over dynamically `import()`-ing a plugin as an ES module from
its `asset://` URL — that pattern is not a reliably documented/supported one in Tauri v2 as of
this writing (module MIME handling over a custom protocol is unsettled), whereas `new Function`
is guaranteed, standard JS behavior in any engine, including WebView2's Chromium engine.

## Not yet implemented

Everything else `Plan.md`'s Plugin Capabilities list mentions is deferred — each needs a host UI
surface that doesn't exist yet:

- Toolbar buttons, context menu items (no plugin-extensible slot in `Toolbar`/`FileList` yet)
- Commands / command palette (no command palette exists in the app at all yet)
- File type handlers (no file-type-to-handler dispatch exists — Preview is hardcoded by extension)
- Settings pages (plugins can't currently contribute their own settings UI)
- Background services, notifications (no lifecycle hooks or notification system exist yet)
- Enable/disable toggle for installed plugins (currently all valid manifests found on disk load
  unconditionally — removing a plugin means removing its folder)
- A real permission-enforcement sandbox (see above)
