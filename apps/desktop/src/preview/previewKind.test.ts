import { describe, expect, it } from "vitest";
import { previewKindFor } from "./previewKind";

describe("previewKindFor", () => {
  it("recognizes images", () => {
    expect(previewKindFor("photo.PNG")).toBe("image");
    expect(previewKindFor("icon.svg")).toBe("image");
  });

  it("recognizes markdown before falling through to plain text", () => {
    expect(previewKindFor("README.md")).toBe("markdown");
  });

  it("recognizes plain text extensions", () => {
    expect(previewKindFor("notes.txt")).toBe("text");
    expect(previewKindFor("config.json")).toBe("text");
  });

  it("recognizes pdf, audio, and video", () => {
    expect(previewKindFor("doc.pdf")).toBe("pdf");
    expect(previewKindFor("song.mp3")).toBe("audio");
    expect(previewKindFor("clip.mp4")).toBe("video");
  });

  it("returns unknown for unrecognized or missing extensions", () => {
    expect(previewKindFor("data.bin")).toBe("unknown");
    expect(previewKindFor("no-extension")).toBe("unknown");
  });
});
