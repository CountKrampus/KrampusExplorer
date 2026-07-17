import { describe, expect, it } from "vitest";
import { isTerminalWindow } from "./windowRouting";

describe("isTerminalWindow", () => {
  it("is true for the 'terminal' window label", () => {
    expect(isTerminalWindow("terminal")).toBe(true);
  });

  it("is false for the main window's label", () => {
    expect(isTerminalWindow("main")).toBe(false);
  });

  it("is false for an empty label", () => {
    expect(isTerminalWindow("")).toBe(false);
  });
});
