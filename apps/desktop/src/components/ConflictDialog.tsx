import { useRef } from "react";
import { useExplorerStore, type PendingConflict } from "../stores/useExplorerStore";
import { resolvePendingConflict } from "../services/fileTransfer";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "./ConflictDialog.css";

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

interface ConflictDialogBodyProps {
  pendingConflict: PendingConflict;
}

// A separate component that only mounts while a conflict is pending, so useFocusTrap's mount
// effect (auto-focus, restore focus on unmount) fires fresh on every open — not just once ever,
// which is what happens if this logic lives in ConflictDialog itself and merely renders `null`
// while closed (the container stays mounted, so the ref's identity never changes between opens).
function ConflictDialogBody({ pendingConflict }: ConflictDialogBodyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, () => resolvePendingConflict("cancel"));

  const name = basename(pendingConflict.source);
  const verb = pendingConflict.mode === "copy" ? "Copying" : "Moving";

  return (
    <div className="conflict-dialog-backdrop" onClick={() => resolvePendingConflict("cancel")}>
      <div
        className="conflict-dialog"
        ref={containerRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <p>
          {verb} "{name}" — an item with that name already exists in the destination folder.
        </p>
        <div className="conflict-dialog__actions">
          <button onClick={() => resolvePendingConflict("replace")}>Replace</button>
          <button onClick={() => resolvePendingConflict("keepBoth")}>Keep Both</button>
          <button onClick={() => resolvePendingConflict("cancel")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ConflictDialog() {
  const pendingConflict = useExplorerStore((state) => state.pendingConflict);

  if (!pendingConflict) return null;

  return <ConflictDialogBody pendingConflict={pendingConflict} />;
}

export default ConflictDialog;
