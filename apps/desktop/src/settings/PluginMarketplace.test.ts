import { describe, expect, it } from "vitest";
import { isInstalled } from "./PluginMarketplace";

describe("isInstalled", () => {
  it("is true when the entry's id is in the installed list", () => {
    expect(isInstalled("b", ["a", "b", "c"])).toBe(true);
  });

  it("is false when the entry's id is not in the installed list", () => {
    expect(isInstalled("d", ["a", "b", "c"])).toBe(false);
  });

  it("is false when nothing is installed", () => {
    expect(isInstalled("a", [])).toBe(false);
  });
});
