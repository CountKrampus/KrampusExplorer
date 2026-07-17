import { describe, expect, it } from "vitest";
import { isTerminalWindow } from "./windowRouting";

describe("isTerminalWindow", () => {
  it("is true when the window query param is 'terminal'", () => {
    expect(isTerminalWindow("?window=terminal")).toBe(true);
  });

  it("is false with no query string", () => {
    expect(isTerminalWindow("")).toBe(false);
  });

  it("is false for an unrelated window param", () => {
    expect(isTerminalWindow("?window=settings")).toBe(false);
  });

  it("is true alongside other query params", () => {
    expect(isTerminalWindow("?cwd=C%3A%5Cfoo&window=terminal")).toBe(true);
  });
});
