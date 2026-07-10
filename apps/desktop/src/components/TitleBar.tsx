import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TitleBar.css";

const appWindow = getCurrentWindow();

function TitleBar() {
  return (
    <div className="title-bar" data-tauri-drag-region>
      <span className="title-bar__title">Project Explorer</span>
      <div className="title-bar__controls">
        <button
          className="title-bar__button"
          aria-label="Minimize"
          onClick={() => appWindow.minimize()}
        >
          &#x2013;
        </button>
        <button
          className="title-bar__button"
          aria-label="Maximize"
          onClick={() => appWindow.toggleMaximize()}
        >
          &#x25A1;
        </button>
        <button
          className="title-bar__button title-bar__button--close"
          aria-label="Close"
          onClick={() => appWindow.close()}
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
