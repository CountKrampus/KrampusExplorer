import { useConfirmStore } from "../stores/useConfirmStore";
import ConfirmDialog from "./ConfirmDialog";

// A wrapper so ConfirmDialog only mounts while a confirmation is actually pending -- matches
// ConflictDialog's identical reasoning (see ConflictDialog.tsx): this makes useFocusTrap's mount
// effect (auto-focus, restore focus on unmount) fire fresh on every open, not just once ever,
// which is what happens if this logic lives here directly and merely renders `null` while closed.
function ConfirmDialogHost() {
  const message = useConfirmStore((state) => state.message);
  const resolve = useConfirmStore((state) => state.resolve);

  if (message === null) return null;

  return (
    <ConfirmDialog message={message} onConfirm={() => resolve(true)} onCancel={() => resolve(false)} />
  );
}

export default ConfirmDialogHost;
