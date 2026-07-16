import { describe, expect, it } from "vitest";
import { filterUninstalled, type MarketplaceEntry } from "./PluginMarketplace";

function entry(id: string): MarketplaceEntry {
  return { id, name: id, description: "" };
}

describe("filterUninstalled", () => {
  it("excludes entries whose id is already installed", () => {
    const entries = [entry("a"), entry("b"), entry("c")];

    const result = filterUninstalled(entries, ["b"]);

    expect(result.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("returns every entry when nothing is installed", () => {
    const entries = [entry("a"), entry("b")];

    expect(filterUninstalled(entries, [])).toEqual(entries);
  });

  it("returns nothing when everything is already installed", () => {
    const entries = [entry("a"), entry("b")];

    expect(filterUninstalled(entries, ["a", "b"])).toEqual([]);
  });
});
