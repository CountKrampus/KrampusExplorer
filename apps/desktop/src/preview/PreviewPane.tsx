import { useActiveTab } from "../stores/useExplorerStore";
import { usePluginStore } from "../stores/usePluginStore";
import { previewKindFor, extensionOf } from "./previewKind";
import MediaPreview from "./MediaPreview";
import TextPreview from "./TextPreview";
import PluginFilePreview from "./PluginFilePreview";
import { formatSize, formatModified } from "../explorer/FileList";
import "./PreviewPane.css";

function PreviewPane() {
  const activeTab = useActiveTab();
  const fileHandlers = usePluginStore((state) => state.fileHandlers);
  const entry = activeTab?.entries.find((e) => e.path === activeTab.selectedPath);

  if (!entry) {
    return (
      <aside className="preview-pane">
        <p className="preview-pane__empty">Select a file to preview</p>
      </aside>
    );
  }

  if (entry.isDir) {
    return (
      <aside className="preview-pane">
        <div className="preview-pane__metadata">
          <p className="preview-pane__name">{"\u{1F4C1} "}{entry.name}</p>
          <p className="preview-pane__detail">Folder</p>
        </div>
      </aside>
    );
  }

  // Plugin-registered file handlers take priority over the built-in preview for extensions
  // they claim (first match wins if more than one plugin claims the same extension).
  const ext = extensionOf(entry.name);
  const pluginHandler = fileHandlers.find((handler) => handler.extensions.includes(ext));
  const kind = previewKindFor(entry.name);

  return (
    <aside className="preview-pane">
      <div className="preview-pane__header">
        <p className="preview-pane__name" title={entry.name}>
          {entry.name}
        </p>
      </div>
      <div className="preview-pane__body">
        {pluginHandler ? (
          <PluginFilePreview handler={pluginHandler} path={entry.path} />
        ) : kind === "image" || kind === "audio" || kind === "video" || kind === "pdf" ? (
          <MediaPreview path={entry.path} kind={kind} />
        ) : kind === "text" || kind === "markdown" ? (
          <TextPreview path={entry.path} markdown={kind === "markdown"} />
        ) : (
          <div className="preview-pane__metadata">
            <p className="preview-pane__detail">{formatSize(entry.size)}</p>
            <p className="preview-pane__detail">{formatModified(entry.modified)}</p>
            <p className="preview-pane__detail preview-pane__detail--muted">No preview available for this file type.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

export default PreviewPane;
