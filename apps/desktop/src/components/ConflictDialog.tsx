import { useExplorerStore } from "../stores/useExplorerStore";
import { resolvePendingConflict } from "../services/fileTransfer";
import "./ConflictDialog.css";

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function ConflictDialog() {
  const pendingConflict = useExplorerStore((state) => state.pendingConflict);

  if (!pendingConflict) return null;

  const name = basename(pendingConflict.source);
  const verb = pendingConflict.mode === "copy" ? "Copying" : "Moving";

  return (
    <div className="conflict-dialog-backdrop">
      <div className="conflict-dialog">
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

export default ConflictDialog;
