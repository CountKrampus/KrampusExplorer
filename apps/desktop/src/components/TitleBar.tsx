import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TitleBar.css";

// Module-scope singleton: each Tauri window (main explorer, detached terminal) gets its own
// isolated JS module instance, so this correctly resolves to whichever window this code is
// actually running in — not always the main window.
const appWindow = getCurrentWindow();

interface TitleBarProps {
  title?: string;
}

function TitleBar({ title = "Krampus Explorer" }: TitleBarProps) {
  return (
    <div className="title-bar" data-tauri-drag-region>
      <span className="title-bar__title">{title}</span>
      <div className="title-bar__controls">
        <button
          className="title-bar__button"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => appWindow.minimize().catch(() => {})}
        >
          &#x2013;
        </button>
        <button
          className="title-bar__button"
          aria-label="Maximize"
          title="Maximize"
          onClick={() => appWindow.toggleMaximize().catch(() => {})}
        >
          &#x25A1;
        </button>
        <button
          className="title-bar__button title-bar__button--close"
          aria-label="Close"
          title="Close"
          onClick={() => appWindow.close().catch(() => {})}
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
