import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import "./TextPreview.css";

interface TextPreviewPayload {
  content: string;
  truncated: boolean;
}

interface TextPreviewProps {
  path: string;
  markdown: boolean;
}

function TextPreview({ path, markdown }: TextPreviewProps) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; error: string } | { status: "ready"; content: string; truncated: boolean }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    invoke<TextPreviewPayload>("read_text_preview", { path })
      .then((result) => {
        if (!cancelled) {
          setState({ status: "ready", content: result.content, truncated: result.truncated });
        }
      })
      .catch((error: string) => {
        if (!cancelled) setState({ status: "error", error: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (state.status === "loading") {
    return <div className="text-preview__message">Loading…</div>;
  }
  if (state.status === "error") {
    return <div className="text-preview__message text-preview__message--error">{state.error}</div>;
  }

  return (
    <div className="text-preview">
      {state.truncated && <div className="text-preview__truncated">Preview truncated — showing the first part of the file.</div>}
      {markdown ? (
        <div
          className="text-preview__markdown"
          // Rendered markdown can embed raw HTML; sanitize before injecting since this is a
          // privileged Tauri webview, not an untrusted browser tab.
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(marked.parse(state.content) as string),
          }}
        />
      ) : (
        <pre className="text-preview__plain">{state.content}</pre>
      )}
    </div>
  );
}

export default TextPreview;
