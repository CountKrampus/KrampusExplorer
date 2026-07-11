import { useEffect, useRef } from "react";
import type { RegisteredFileHandler } from "../stores/usePluginStore";

interface PluginFilePreviewProps {
  handler: RegisteredFileHandler;
  path: string;
}

function PluginFilePreview({ handler, path }: PluginFilePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cleanup = handler.render(path, container);
    return () => {
      cleanup?.();
      container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handler.pluginId, handler.id, path]);

  return <div ref={containerRef} />;
}

export default PluginFilePreview;
