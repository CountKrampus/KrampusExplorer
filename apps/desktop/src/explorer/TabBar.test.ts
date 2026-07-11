import { describe, expect, it } from "vitest";
import { tabLabel } from "./TabBar";

describe("tabLabel", () => {
  it("returns the last segment of a nested Windows path", () => {
    expect(tabLabel("C:\\Users\\boo")).toBe("boo");
  });

  it("returns the drive letter for a Windows drive root", () => {
    expect(tabLabel("C:\\")).toBe("C:");
  });

  it("returns the last segment of a Unix path", () => {
    expect(tabLabel("/home/boo")).toBe("boo");
  });

  it("returns the path itself when there are no separators to split on", () => {
    expect(tabLabel("/")).toBe("/");
  });
});
