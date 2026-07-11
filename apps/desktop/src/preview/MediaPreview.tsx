import { convertFileSrc } from "@tauri-apps/api/core";
import type { PreviewKind } from "./previewKind";
import "./MediaPreview.css";

interface MediaPreviewProps {
  path: string;
  kind: Extract<PreviewKind, "image" | "audio" | "video" | "pdf">;
}

function MediaPreview({ path, kind }: MediaPreviewProps) {
  const src = convertFileSrc(path);

  if (kind === "image") {
    return (
      <div className="media-preview media-preview--image">
        <img src={src} alt="" />
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="media-preview media-preview--audio">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio controls src={src} />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="media-preview media-preview--video">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video controls src={src} />
      </div>
    );
  }

  return (
    <div className="media-preview media-preview--pdf">
      <iframe title="PDF preview" src={src} />
    </div>
  );
}

export default MediaPreview;
