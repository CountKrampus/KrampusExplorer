import { describe, expect, it } from "vitest";
import { formatMeta } from "./WipPlugins";
import type { PluginManifest } from "../types/plugin";

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    author: "Someone",
    permissions: [],
    entry: "index.js",
    dir: "/plugins-wip/test-plugin",
    hasIcon: false,
    ...overrides,
  };
}

describe("formatMeta", () => {
  it("omits permissions when there are none", () => {
    expect(formatMeta(manifest())).toBe("v1.0.0 by Someone");
  });

  it("appends joined permissions when present", () => {
    expect(formatMeta(manifest({ permissions: ["ui.sidebar", "nav.read"] }))).toBe(
      "v1.0.0 by Someone — ui.sidebar, nav.read",
    );
  });
});
