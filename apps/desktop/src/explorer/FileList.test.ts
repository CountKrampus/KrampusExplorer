import { describe, expect, it } from "vitest";
import { formatSize, formatModified } from "./FileList";

describe("formatSize", () => {
  it("returns an empty string for null (directories)", () => {
    expect(formatSize(null)).toBe("");
  });

  it("formats bytes", () => {
    expect(formatSize(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatSize(2048)).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});

describe("formatModified", () => {
  it("returns an empty string for null", () => {
    expect(formatModified(null)).toBe("");
  });

  it("returns an empty string for a non-numeric string", () => {
    expect(formatModified("not-a-number")).toBe("");
  });

  it("formats a valid epoch-seconds string as a locale date string", () => {
    const result = formatModified("0");
    expect(result).toBe(new Date(0).toLocaleString());
  });
});
