# Drive List Auto-Refresh — Design

## Goal

`apps/desktop/src/sidebar/DriveList.tsx` fetches the drive list exactly once, in a `useEffect`
with an empty dependency array, when the component first mounts. Plugging in a USB stick (or any
other removable drive) after the app is already running never shows up — there's no polling, no
"device plugged in" listener, and no manual refresh option. Discovered while planning how to
safely test the upcoming Drive Format and Secure Wipe plugins against a USB stick rather than a
real internal drive: if the stick doesn't show up without restarting the app, that testing
workflow is annoying enough to actively discourage using it.

The backend (`get_drives` Tauri command / `list_drives` in `crates/filesystem/src/drives.rs`) is
already correct — it scans every drive letter A–Z fresh on each call. The bug is entirely that
nothing ever asks it again after the first call.

## Fix: three refresh triggers, one shared function

All three converge on a single `refreshDrives` function (wrapped in `useCallback` for a stable
identity across renders, needed by the effects below):

1. **On mount** — the existing behavior, unchanged in effect.
2. **On window focus** — `window.addEventListener("focus", refreshDrives)`, covering the common
   case (plug in a stick, alt-tab back to the app). Removed on unmount.
3. **Every 5 seconds** — `setInterval(refreshDrives, 5000)`, covering the remaining case where the
   app window was already focused when the drive was plugged in (so no `focus` event ever fires).
   Cleared on unmount. `list_drives` is a cheap local operation (26 `std::fs::metadata` calls plus
   one `GetDiskFreeSpaceExW` call per existing drive, no network/disk-heavy work), so a 5-second
   poll has no meaningful cost for as long as the app is open.
4. **A manual Refresh button**, rendered above the drive list inside the existing `Drives`
   `CollapsibleSection` (not inside `CollapsibleSection` itself, which has no header-action slot
   and doesn't need one added just for this) — matches the same button placement/style pattern the
   Recycling Bin plugin already uses for its own Refresh button.

## No flicker on refresh

The existing code shows a full "Loading…" replacement for the whole list while `drives === null`.
That's fine for the very first fetch, but must NOT happen on every subsequent refresh (focus, poll,
or manual) — otherwise the sidebar's entire drive list would flash away and reappear every 5
seconds, which would be actively annoying. Refreshes after the first successful load keep
rendering the last known `drives` array while `refreshDrives` re-fetches in the background, and
only swap in the new array once it resolves. The existing `error` state also isn't cleared until a
refresh actually resolves (success or failure), so a transient failure mid-poll doesn't flash an
error over a perfectly good existing list — errors only replace the list on the very first fetch,
same as today; a failed background refresh is silently ignored and the last known list stays
displayed (logged nowhere new — this mirrors how the initial fetch already reports errors via
`error` state, but only when there's no list to fall back on yet).

## Scope

`apps/desktop/src/sidebar/DriveList.tsx` only. No backend changes (the existing `get_drives`
Tauri command is reused as-is), no changes to `CollapsibleSection.tsx` or any other sidebar
component.

## Testing

`DriveList.tsx` has no existing test file, and this codebase doesn't currently have component
tests for sidebar UI pieces (no `*.test.tsx` files under `apps/desktop/src/sidebar/`) — matching
that existing convention, this fix gets no new automated tests. Verified by hand instead: confirm
a drive that wasn't present at launch appears within 5 seconds without any user action, and that
clicking Refresh immediately shows a newly-plugged drive.
