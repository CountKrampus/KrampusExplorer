import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TitleBar.css";

// Module-scope singleton: this app has exactly one window. Tests that import
// TitleBar (directly or via App.tsx) need to mock @tauri-apps/api/window
// before import, since this call runs at module load time, not render time.
const appWindow = getCurrentWindow();

function TitleBar() {
  return (
    <div className="title-bar" data-tauri-drag-region>
      <span className="title-bar__title">Krampus Explorer</span>
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
