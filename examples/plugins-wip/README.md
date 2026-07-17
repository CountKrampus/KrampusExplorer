# plugins-wip

Plugins being developed but not yet published to the marketplace live here, one subdirectory
each (same `manifest.json` + entry file shape as `examples/plugins/`). Nothing in the app reads
`marketplace.json` or fetches from this folder over the network — a plugin here is invisible to
the marketplace UI entirely until it's moved into `examples/plugins/` and given an entry in
`marketplace.json`.

Instead, Settings → Plugins → "Local Plugins (dev)" (only useful on a dev build running from a
real checkout of this repo) lists whatever's in here and lets you sync a plugin's files straight
into your local plugins directory with one click — no `git push` and no marketplace round trip
needed while you're iterating. See `docs/plugins.md`'s "Local (dev) plugins" section for details.

When a plugin here is ready to ship: move its directory into `examples/plugins/`, add an entry
to `marketplace.json`, and commit/push as normal.
