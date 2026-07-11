import { create } from "zustand";

export interface TransferProgress {
  copied: number;
  total: number;
}

interface TransferState {
  progress: TransferProgress | null;
  setProgress: (progress: TransferProgress | null) => void;
}

export const useTransferStore = create<TransferState>((set) => ({
  progress: null,
  setProgress: (progress) => set({ progress }),
}));
