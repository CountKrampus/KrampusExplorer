# Building and releasing

This covers three things: building a local (unsigned) installer, how the signed CI release
pipeline works, and how to cut a new release.

## Local build (unsigned)

```sh
cd apps/desktop
npm install
npm run tauri build
```

Produces an MSI and an NSIS `setup.exe` under
`apps/desktop/src-tauri/target/release/bundle/` (`msi/` and `nsis/`). These aren't signed with
the updater key, so the auto-updater won't offer them and Windows SmartScreen will warn on first
run — fine for local testing, not for distribution.

## Signed CI releases

`.github/workflows/release.yml` builds, signs, and publishes installers to GitHub Releases
whenever a `v*` tag is pushed. It runs on `windows-latest`, builds via
`tauri-apps/tauri-action@v1`, and uploads the MSI, the NSIS `setup.exe`, their `.sig` signature
files, and `latest.json` (the file the in-app updater polls) to the release.

### One-time setup

**Signing key** — generated with:

```sh
npx tauri signer generate -f --ci -w "$HOME/.tauri/<name>.key"
```

The key is intentionally passwordless (`--ci` skips the password prompt) — GitHub Actions
secrets can't be set to an empty value, so a password-protected key would mean two secrets that
have to stay in sync (the key contents and its password), which is a needless source of
mismatch failures for a solo/small project. If you want the extra protection, pass `-p
"<password>"` instead of `--ci` and add a matching `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret —
but run that on your own machine, never through an agent/CI shell, since the password must never
be passed as a bare CLI argument or committed anywhere.

The command prints a public key (`dW50cnVzdGVk...`); put that string in
`apps/desktop/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. The private key file
itself stays local and is never committed.

**Repository secret** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Full contents of the `.key` file generated above |

If you ever regenerate the key, update **both** the `pubkey` in `tauri.conf.json` and this
secret — they have to match the same keypair. A stale/empty secret here is the most common cause
of the release workflow failing at the sign/publish step with "A public key has been found, but
no private key."

**Repo visibility** — the updater's `endpoints` in `tauri.conf.json` point at
`.../releases/latest/download/latest.json` on GitHub. For unauthenticated downloads to work
(the desktop app has no embedded GitHub token), the repository needs to be public.

### Cutting a release

1. Bump `version` in `apps/desktop/src-tauri/tauri.conf.json` if it hasn't already been bumped.
2. Make sure `main`/`master` is green: `cargo test --workspace`, `cargo clippy --workspace
   --all-targets -- -D warnings`, and in `apps/desktop`: `npm test -- --run && npm run build`.
3. Tag and push:

   ```sh
   git tag -a vX.Y.Z -m "Krampus Explorer vX.Y.Z"
   git push origin vX.Y.Z
   ```

4. Watch the **Release** workflow under the Actions tab. On success it publishes a GitHub
   Release with the installers attached and `latest.json` for the updater.

Re-running a failed release for the same version means deleting the tag both locally and on the
remote before re-pushing it (`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`) — treat
this as a deliberate, explicit step rather than something to do reflexively, since it discards
the failed run's tag history.

### Common CI failure: stale lockfile

The release workflow uses `npm ci`, which fails hard on any drift between `package.json` and
`package-lock.json` (unlike `npm install`, which quietly patches it up). If a dependency was
added with `npm install` but the lockfile update didn't fully propagate (missing optional
platform packages for a transitive dependency is the usual symptom), regenerate it clean:

```sh
cd apps/desktop
rm -rf node_modules package-lock.json
npm install
rm -rf node_modules
npm ci   # should succeed with no changes to package-lock.json
```

Commit the regenerated `package-lock.json` before re-tagging.

## Auto-update

`apps/desktop/src/stores/useUpdateStore.ts` wraps `@tauri-apps/plugin-updater`. On launch,
`App.tsx` silently calls `checkForUpdates()` — no toast or dialog. Settings → Updates shows the
current version, lets the user manually check, and (if an update is available) download and
install it, which relaunches the app via `@tauri-apps/plugin-process`.

**What auto-update does and doesn't ship:** a release only contains the core app binary — the
Rust backend and bundled React frontend. Plugins (`examples/plugins/`) are never part of the
installer; they only ever reach a user's machine via manual copy into
`%APPDATA%\Krampus Explorer\plugins\` or the in-app marketplace (`docs/plugins.md`'s "Plugin
marketplace" section), neither of which auto-update touches. A plugin using a backend capability
newer than the installed app version (e.g. a new `fs.*` permission) won't work until the app
itself is updated — plugin JS hot-reloads on every launch, but the backend commands it calls
don't exist until the binary containing them is installed.
