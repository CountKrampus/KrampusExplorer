import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TerminalWindow from "./terminal/TerminalWindow";
import { isTerminalWindow } from "./windowRouting";

const Root = isTerminalWindow(window.location.search) ? TerminalWindow : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
