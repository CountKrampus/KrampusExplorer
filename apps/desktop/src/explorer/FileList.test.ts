import { describe, expect, it } from "vitest";
import { formatSize, formatModified, sortEntries } from "./FileList";
import type { EntryInfo } from "../types/filesystem";

function entry(overrides: Partial<EntryInfo>): EntryInfo {
  return {
    name: "a",
    path: "/a",
    isDir: false,
    size: null,
    modified: null,
    created: null,
    ...overrides,
  };
}

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

describe("sortEntries", () => {
  it("always puts folders before files regardless of sort field", () => {
    const entries = [entry({ name: "z_file.txt", isDir: false }), entry({ name: "a_folder", isDir: true })];

    const sorted = sortEntries(entries, "name", "asc");

    expect(sorted.map((e) => e.name)).toEqual(["a_folder", "z_file.txt"]);
  });

  it("sorts by size ascending and descending", () => {
    const entries = [
      entry({ name: "big.txt", size: 300 }),
      entry({ name: "small.txt", size: 10 }),
      entry({ name: "medium.txt", size: 100 }),
    ];

    const asc = sortEntries(entries, "size", "asc");
    expect(asc.map((e) => e.name)).toEqual(["small.txt", "medium.txt", "big.txt"]);

    const desc = sortEntries(entries, "size", "desc");
    expect(desc.map((e) => e.name)).toEqual(["big.txt", "medium.txt", "small.txt"]);
  });

  it("sorts by name case-insensitively", () => {
    const entries = [entry({ name: "banana" }), entry({ name: "Apple" }), entry({ name: "cherry" })];

    const sorted = sortEntries(entries, "name", "asc");

    expect(sorted.map((e) => e.name)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("sorts by type (extension), folders excluded from the extension comparison", () => {
    const entries = [
      entry({ name: "photo.png" }),
      entry({ name: "notes.txt" }),
      entry({ name: "archive.zip" }),
      entry({ name: "some_folder", isDir: true }),
    ];

    const sorted = sortEntries(entries, "type", "asc");

    // Folder still sorts first (isDir precedence), then files ordered by extension (png < txt < zip).
    expect(sorted.map((e) => e.name)).toEqual(["some_folder", "photo.png", "notes.txt", "archive.zip"]);
  });

  it("sorts by modified date ascending and descending", () => {
    const entries = [
      entry({ name: "newest.txt", modified: "300" }),
      entry({ name: "oldest.txt", modified: "100" }),
      entry({ name: "middle.txt", modified: "200" }),
    ];

    const asc = sortEntries(entries, "modified", "asc");
    expect(asc.map((e) => e.name)).toEqual(["oldest.txt", "middle.txt", "newest.txt"]);

    const desc = sortEntries(entries, "modified", "desc");
    expect(desc.map((e) => e.name)).toEqual(["newest.txt", "middle.txt", "oldest.txt"]);
  });

  it("sorts by created date", () => {
    const entries = [entry({ name: "newer.txt", created: "200" }), entry({ name: "older.txt", created: "100" })];

    const sorted = sortEntries(entries, "created", "asc");

    expect(sorted.map((e) => e.name)).toEqual(["older.txt", "newer.txt"]);
  });
});
