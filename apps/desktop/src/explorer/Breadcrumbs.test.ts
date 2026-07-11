import { describe, expect, it } from "vitest";
import { splitPath } from "./Breadcrumbs";

describe("splitPath", () => {
  it("splits a Windows drive root into a single crumb", () => {
    expect(splitPath("C:\\")).toEqual([{ label: "C:", path: "C:\\" }]);
  });

  it("splits a nested Windows path into cumulative crumbs", () => {
    expect(splitPath("C:\\Users\\boo")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "boo", path: "C:\\Users\\boo" },
    ]);
  });

  it("splits a Unix path into cumulative crumbs", () => {
    expect(splitPath("/home/boo")).toEqual([
      { label: "home", path: "/home" },
      { label: "boo", path: "/home/boo" },
    ]);
  });

  it("returns a single root crumb for the Unix root path", () => {
    expect(splitPath("/")).toEqual([{ label: "/", path: "/" }]);
  });
});
