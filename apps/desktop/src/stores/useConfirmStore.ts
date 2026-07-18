import { create } from "zustand";

interface ConfirmState {
  /** The message currently awaiting a yes/no answer, or `null` if nothing is pending. Only one
   * confirmation can be pending at a time -- see `requestConfirm`. */
  message: string | null;
  /** Shows a confirmation with `message` and resolves to whether the user confirmed. If another
   * request is already pending when this is called, that earlier request is immediately
   * resolved to `false` (auto-cancelled) rather than left to hang forever, since the UI can only
   * ever show one confirmation at a time. */
  requestConfirm: (message: string) => Promise<boolean>;
  /** Resolves the currently pending request (if any) and clears `message`. Called by
   * `ConfirmDialogHost`'s Confirm/Cancel buttons, not meant to be called directly by plugin
   * code. */
  resolve: (result: boolean) => void;
}

let pendingResolve: ((result: boolean) => void) | null = null;

export const useConfirmStore = create<ConfirmState>((set) => ({
  message: null,

  requestConfirm: (message) => {
    pendingResolve?.(false);
    return new Promise<boolean>((resolvePromise) => {
      pendingResolve = resolvePromise;
      set({ message });
    });
  },

  resolve: (result) => {
    set({ message: null });
    pendingResolve?.(result);
    pendingResolve = null;
  },
}));
