import { describe, expect, it, vi } from "vitest";
import { filterCommands, type CommandPaletteEntry } from "./CommandPalette";

function entry(id: string, label: string, source = "core"): CommandPaletteEntry {
  return { id, label, run: vi.fn(), source };
}

describe("filterCommands", () => {
  it("returns every command, unranked, when the query is blank", () => {
    const commands = [entry("b", "Banana"), entry("a", "Apple")];

    expect(filterCommands(commands, "")).toEqual(commands);
    expect(filterCommands(commands, "   ")).toEqual(commands);
  });

  it("matches case-insensitively on a substring of the label", () => {
    const commands = [entry("1", "Open Settings"), entry("2", "New Tab")];

    const results = filterCommands(commands, "settings");

    expect(results.map((c) => c.id)).toEqual(["1"]);
  });

  it("excludes commands whose label doesn't contain the query", () => {
    const commands = [entry("1", "Refresh"), entry("2", "Go Back")];

    expect(filterCommands(commands, "settings")).toEqual([]);
  });

  it("ranks earlier match positions before later ones", () => {
    const commands = [entry("1", "New Tab Settings"), entry("2", "Settings")];

    const results = filterCommands(commands, "settings");

    expect(results.map((c) => c.id)).toEqual(["2", "1"]);
  });

  it("breaks ties alphabetically when match position is equal", () => {
    const commands = [entry("1", "Zebra Tool"), entry("2", "Apple Tool")];

    const results = filterCommands(commands, "tool");

    expect(results.map((c) => c.id)).toEqual(["2", "1"]);
  });
});
