export type PreviewKind = "image" | "text" | "markdown" | "pdf" | "audio" | "video" | "unknown";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "log",
  "json",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "csv",
  "cfg",
  "conf",
  "js",
  "ts",
  "tsx",
  "jsx",
  "rs",
  "py",
  "css",
  "html",
]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mkv", "mov", "avi"]);

export function extensionOf(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex <= 0 ? "" : name.slice(dotIndex + 1).toLowerCase();
}

export function previewKindFor(name: string): PreviewKind {
  const ext = extensionOf(name);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (ext === "pdf") return "pdf";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return "unknown";
}
