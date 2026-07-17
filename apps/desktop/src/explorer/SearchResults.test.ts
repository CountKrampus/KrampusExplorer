import { describe, expect, it } from "vitest";
import { isTruncated } from "./SearchResults";
import { SEARCH_RESULT_CAP } from "../stores/useSearchStore";

describe("isTruncated", () => {
  it("is false when result count is below the cap", () => {
    expect(isTruncated(SEARCH_RESULT_CAP - 1)).toBe(false);
  });

  it("is false for zero results", () => {
    expect(isTruncated(0)).toBe(false);
  });

  it("is true when result count equals the cap", () => {
    expect(isTruncated(SEARCH_RESULT_CAP)).toBe(true);
  });
});
