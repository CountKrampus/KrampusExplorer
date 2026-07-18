# Drive List Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make newly-plugged drives (USB sticks, etc.) show up in the sidebar's Drives section
without requiring an app restart.

**Architecture:** A single `refreshDrives` function in `DriveList.tsx`, called from three
triggers (mount, window focus, a 5-second interval) plus a manual Refresh button — all sharing one
code path, with no full-list flicker on anything but the very first fetch.

**Tech Stack:** React, TypeScript.

Full design: `docs/superpowers/specs/2026-07-18-drive-list-auto-refresh-design.md`.

---

### Task 1: Add the refresh triggers and manual button to `DriveList.tsx`

**Files:**
- Modify: `apps/desktop/src/sidebar/DriveList.tsx`
- Modify: `apps/desktop/src/sidebar/Sidebar.css`

This fix has no automated tests, matching this codebase's existing convention for sidebar UI
components (no `*.test.tsx` files exist under `apps/desktop/src/sidebar/` today) — see the design
doc's Testing section. Verification is manual, in Step 5 below.

- [ ] **Step 1: Rewrite `DriveList.tsx`**

Replace the full contents of `apps/desktop/src/sidebar/DriveList.tsx` with:

```tsx
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DriveInfo } from "../types/filesystem";
import { useExplorerStore } from "../stores/useExplorerStore";
import { formatSize } from "../explorer/FileList";
import CollapsibleSection from "./CollapsibleSection";

const POLL_INTERVAL_MS = 5000;

function DriveList() {
  const [drives, setDrives] = useState<DriveInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigateTo = useExplorerStore((state) => state.navigateTo);

  // Shared by every refresh trigger below (mount, window focus, the poll, and the manual
  // button) so there's exactly one place that decides how a refresh updates state. Only the
  // very first call (drives === null) leaves the user looking at "Loading…" -- every later call
  // keeps showing the last known list while this quietly re-fetches in the background, so
  // refocusing the window or the 5s poll never flashes the sidebar empty.
  const refreshDrives = useCallback(() => {
    invoke<DriveInfo[]>("get_drives")
      .then((result) => {
        setDrives(result);
        setError(null);
      })
      .catch((err: unknown) => setError(String(err)));
  }, []);

  useEffect(() => {
    refreshDrives();
  }, [refreshDrives]);

  useEffect(() => {
    window.addEventListener("focus", refreshDrives);
    return () => window.removeEventListener("focus", refreshDrives);
  }, [refreshDrives]);

  useEffect(() => {
    const id = setInterval(refreshDrives, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshDrives]);

  return (
    <CollapsibleSection sectionId="drives" title="Drives">
      <button type="button" className="sidebar__refresh-button" onClick={refreshDrives}>
        Refresh
      </button>
      {error && drives === null ? (
        <p className="sidebar__message sidebar__message--error">{error}</p>
      ) : drives === null ? (
        <p className="sidebar__message">Loading…</p>
      ) : (
        <ul className="sidebar__list">
          {drives.map((drive) => {
            const usedFraction =
              drive.totalBytes && drive.totalBytes > 0 && drive.freeBytes !== null
                ? (drive.totalBytes - drive.freeBytes) / drive.totalBytes
                : null;
            return (
              <li key={drive.path}>
                <button className="sidebar__item sidebar__item--drive" onClick={() => navigateTo(drive.path)}>
                  <span className="sidebar__drive-name">{drive.name}</span>
                  {usedFraction !== null && (
                    <>
                      <span className="sidebar__drive-bar">
                        <span
                          className="sidebar__drive-bar-fill"
                          style={{ width: `${Math.round(usedFraction * 100)}%` }}
                        />
                      </span>
                      <span className="sidebar__drive-space">
                        {formatSize(drive.freeBytes)} free of {formatSize(drive.totalBytes)}
                      </span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </CollapsibleSection>
  );
}

export default DriveList;
```

Note the `error` check changed from `error ? ... : drives === null ? ...` to
`error && drives === null ? ... : drives === null ? ...` — this is the "don't flash an error over
a perfectly good existing list" behavior from the design doc: once a list has loaded successfully
at least once, a later failed background refresh (poll or focus) leaves `error` set but `drives`
non-null, and this condition intentionally falls through to rendering the last known list instead
of replacing it with the error message. Only a failure on the very first fetch (`drives` still
`null`) shows the error state.

- [ ] **Step 2: Add the Refresh button's styling**

In `apps/desktop/src/sidebar/Sidebar.css`, add after the existing `.sidebar__message--error` rule:

```css
.sidebar__refresh-button {
  margin: 2px 12px 4px;
  padding: 3px 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}

.sidebar__refresh-button:hover {
  background: var(--border);
  color: var(--fg);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Run the full frontend test suite**

Run: `cd apps/desktop && npm test -- --run`
Expected: all existing tests still pass (this change adds no new test files, per this task's
intro).

- [ ] **Step 5: Manual verification (cannot be automated)**

With the dev build running (`npm run tauri dev`):

1. With the app window focused, plug in a USB stick. Wait up to 5 seconds without touching the
   app. Confirm the stick appears in the Drives section on its own (proves the poll works).
2. Unplug it. Switch to a different window, then switch back to the app. Confirm the stick (now
   removed) disappears within a moment of refocusing (proves the focus listener works) --
   plug it back in first if you want to instead confirm it *appears* on refocus.
3. Click the new Refresh button and confirm it doesn't error and the list stays correct (proves
   the manual path works and shares the same code as the other two).
4. While the list is showing at least one drive, watch it across a poll cycle (5+ seconds) and
   confirm the list does NOT flicker/flash to "Loading…" during a routine background refresh --
   it should stay static unless the actual drive set changes.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/sidebar/DriveList.tsx apps/desktop/src/sidebar/Sidebar.css
git commit -m "Auto-refresh the drive list on window focus and a 5s poll, plus a manual button"
```
