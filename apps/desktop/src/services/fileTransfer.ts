import { invoke, Channel } from "@tauri-apps/api/core";
import { useExplorerStore } from "../stores/useExplorerStore";
import { useTransferStore, type TransferProgress } from "../stores/useTransferStore";
import { useToastStore } from "../stores/useToastStore";
import { uniqueName } from "../utils/uniqueName";

export type TransferMode = "copy" | "move";

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

async function invokeTransfer(
  mode: TransferMode,
  source: string,
  destDir: string,
  destName: string | undefined,
  overwrite: boolean,
): Promise<string> {
  const command = mode === "copy" ? "copy_entry_with_progress" : "move_entry_with_progress";
  const setProgress = useTransferStore.getState().setProgress;
  const onProgress = new Channel<TransferProgress>();
  onProgress.onmessage = (payload) => setProgress(payload);

  try {
    return await invoke<string>(command, {
      source,
      destDir,
      destName: destName ?? null,
      overwrite,
      onProgress,
    });
  } finally {
    setProgress(null);
  }
}

/** Attempts a copy/move; opens the conflict dialog (via store state) instead of failing outright
 * if the destination already has an item with that name. */
export async function performTransfer(source: string, destDir: string, mode: TransferMode) {
  const store = useExplorerStore.getState();
  try {
    const newPath = await invokeTransfer(mode, source, destDir, undefined, false);
    store.setSelected(newPath);
    store.refresh();
    if (mode === "move") store.setClipboard(null);
  } catch (error) {
    if (error === "EEXIST") {
      store.setPendingConflict({ source, destDir, mode });
    } else {
      useToastStore.getState().showToast(String(error));
    }
  }
}

export async function resolvePendingConflict(action: "replace" | "keepBoth" | "cancel") {
  const store = useExplorerStore.getState();
  const conflict = store.pendingConflict;
  if (!conflict) return;
  store.setPendingConflict(null);
  if (action === "cancel") return;

  let destName: string | undefined;
  if (action === "keepBoth") {
    const activeTab = store.tabs.find((tab) => tab.id === store.activeTabId);
    const existingNames = new Set((activeTab?.entries ?? []).map((entry) => entry.name));
    destName = uniqueName(basename(conflict.source), existingNames);
  }

  try {
    const newPath = await invokeTransfer(
      conflict.mode,
      conflict.source,
      conflict.destDir,
      destName,
      action === "replace",
    );
    store.setSelected(newPath);
    store.refresh();
    if (conflict.mode === "move") store.setClipboard(null);
  } catch (error) {
    useToastStore.getState().showToast(String(error));
  }
}
