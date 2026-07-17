import { describe, expect, it } from "vitest";
import { ROW_HEIGHT_PX, shouldVirtualize, VIRTUALIZATION_THRESHOLD } from "./virtualization";

describe("shouldVirtualize", () => {
  it("is false at or below the threshold", () => {
    expect(shouldVirtualize(VIRTUALIZATION_THRESHOLD)).toBe(false);
    expect(shouldVirtualize(1)).toBe(false);
    expect(shouldVirtualize(0)).toBe(false);
  });

  it("is true above the threshold", () => {
    expect(shouldVirtualize(VIRTUALIZATION_THRESHOLD + 1)).toBe(true);
  });
});

describe("ROW_HEIGHT_PX", () => {
  it("defines a positive height for every icon size", () => {
    expect(ROW_HEIGHT_PX.small).toBeGreaterThan(0);
    expect(ROW_HEIGHT_PX.medium).toBeGreaterThan(0);
    expect(ROW_HEIGHT_PX.large).toBeGreaterThan(0);
  });

  it("increases with icon size", () => {
    expect(ROW_HEIGHT_PX.medium).toBeGreaterThan(ROW_HEIGHT_PX.small);
    expect(ROW_HEIGHT_PX.large).toBeGreaterThan(ROW_HEIGHT_PX.medium);
  });
});
