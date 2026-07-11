import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "error";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  body: string | null;
  error: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  pendingUpdate: Update | null;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  version: null,
  body: null,
  error: null,
  downloadedBytes: 0,
  totalBytes: null,
  pendingUpdate: null,

  checkForUpdates: async () => {
    set({ status: "checking", error: null });
    try {
      const update = await check();
      if (update) {
        set({
          status: "available",
          version: update.version,
          body: update.body ?? null,
          pendingUpdate: update,
        });
      } else {
        set({ status: "up-to-date", pendingUpdate: null });
      }
    } catch (error) {
      set({ status: "error", error: String(error) });
    }
  },

  installUpdate: async () => {
    const update = get().pendingUpdate;
    if (!update) return;
    set({ status: "downloading", downloadedBytes: 0, totalBytes: null, error: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          set({ totalBytes: event.data.contentLength ?? null });
        } else if (event.event === "Progress") {
          set((state) => ({ downloadedBytes: state.downloadedBytes + event.data.chunkLength }));
        }
      });
      await relaunch();
    } catch (error) {
      set({ status: "error", error: String(error) });
    }
  },
}));
