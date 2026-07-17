import type { IconSize } from "../stores/useSettingsStore";

/** Folders at or below this many entries render through the plain, non-virtualized <table>
 * path (FileTable) -- comfortably above where that path is smooth. Folders above it render
 * through VirtualFileTable instead. See
 * docs/superpowers/specs/2026-07-17-file-list-virtualization-design.md. */
export const VIRTUALIZATION_THRESHOLD = 150;

export function shouldVirtualize(entryCount: number): boolean {
  return entryCount > VIRTUALIZATION_THRESHOLD;
}

/** Fixed pixel row height per icon size, used as VirtualFileTable's FixedSizeList itemSize.
 * Matches FileTable's browser-computed row height (padding + font-size, see FileList.css) at
 * each icon size, so crossing VIRTUALIZATION_THRESHOLD doesn't visibly jump. */
export const ROW_HEIGHT_PX: Record<IconSize, number> = {
  small: 24,
  medium: 28,
  large: 36,
};
