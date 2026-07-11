# Hello Sidebar (example plugin)

The minimal example: a plugin that registers one sidebar panel.

## Structure

```
hello-sidebar/
  manifest.json       required fields: id, name, version, author, entry;
                       permissions is optional (defaults to [])
  frontend/index.js    the entry file — plain JS, not an ES module
```

## Installing it locally

Copy this whole folder into your plugins directory and restart the app:

- Windows: `%APPDATA%\Krampus Explorer\plugins\`

(That directory is created automatically the first time the app looks for plugins, so it'll
already exist once you've launched the app at least once.)

## How it works

- `manifest.json` declares the `ui.sidebar` permission, which is what grants access to
  `api.registerSidebarPanel` — a plugin that doesn't declare a permission simply doesn't have
  the corresponding method on `api`.
- `frontend/index.js` is executed with a single `api` argument in scope. It is **not** loaded as
  an ES module (no `import`/`export`) — see `docs/plugins.md` at the repo root for why, and for
  the full API reference and current limitations.
