import { useEffect, useRef, useState } from "react";
import type { RegisteredFileHandler } from "../stores/usePluginStore";

interface PluginFilePreviewProps {
  handler: RegisteredFileHandler;
  path: string;
}

function PluginFilePreview({ handler, path }: PluginFilePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setError(null);
    let cleanup: void | (() => void);
    try {
      cleanup = handler.render(path, container);
    } catch (err) {
      setError(String(err));
      return;
    }
    return () => {
      try {
        cleanup?.();
      } catch {
        // The preview is being torn down anyway; a throwing cleanup shouldn't block that.
      }
      container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handler.pluginId, handler.id, path]);

  if (error) {
    return (
      <div className="preview-pane__metadata">
        <p className="preview-pane__detail preview-pane__detail--muted">
          This preview failed to load: {error}
        </p>
      </div>
    );
  }

  return <div ref={containerRef} />;
}

export default PluginFilePreview;
