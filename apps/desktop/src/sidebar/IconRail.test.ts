import { describe, expect, it } from "vitest";
import { panelKey } from "./IconRail";

describe("panelKey", () => {
  it("joins pluginId and panelId with a colon", () => {
    expect(panelKey("duplicate-finder", "duplicate-finder")).toBe("duplicate-finder:duplicate-finder");
  });

  it("keeps distinct plugins with the same panel id from colliding", () => {
    expect(panelKey("plugin-a", "main")).not.toBe(panelKey("plugin-b", "main"));
  });
});
