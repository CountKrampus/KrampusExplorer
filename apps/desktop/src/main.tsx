import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { isTerminalWindow } from "./windowRouting";

// Lazy-loaded, not statically imported: TerminalWindow pulls in xterm.js, which the main
// explorer window never uses. A static import would put xterm.js in every window's bundle
// (it roughly doubled the built JS size when tried) even though only the detached terminal
// window ever needs it.
const TerminalWindow = lazy(() => import("./terminal/TerminalWindow"));

const Root = isTerminalWindow(getCurrentWindow().label) ? TerminalWindow : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </React.StrictMode>,
);
