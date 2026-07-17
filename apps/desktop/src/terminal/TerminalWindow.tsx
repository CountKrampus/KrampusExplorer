import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import TitleBar from "../components/TitleBar";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { addTab, initialTabs, removeTab, type TerminalTabState } from "./tabs";
import "@xterm/xterm/css/xterm.css";
import "../styles/theme.css";
import "../styles/global.css";
import "./TerminalWindow.css";

interface TerminalChunk {
  data: string;
}

interface TerminalTabProps {
  cwd: string | null;
}

function TerminalTabView({ cwd }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({ convertEol: true, fontSize: 13 });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    let sessionId: string | null = null;
    let cancelled = false;
    let disposed = false;

    const onOutput = new Channel<TerminalChunk>();
    onOutput.onmessage = (chunk) => {
      if (!disposed) term.write(chunk.data);
    };

    invoke<string>("terminal_spawn", { cwd, onOutput })
      .then((id) => {
        if (cancelled) {
          void invoke("terminal_close", { sessionId: id });
          return;
        }
        sessionId = id;
        void invoke("terminal_resize", { sessionId: id, cols: term.cols, rows: term.rows });
      })
      .catch((error: unknown) => {
        term.write(`\r\n\x1b[31mCould not start a shell: ${String(error)}\x1b[0m\r\n`);
      });

    const dataDisposable = term.onData((data) => {
      if (sessionId) void invoke("terminal_write", { sessionId, data });
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (sessionId) {
        void invoke("terminal_resize", { sessionId, cols: term.cols, rows: term.rows });
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      disposed = true;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      if (sessionId) void invoke("terminal_close", { sessionId });
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="terminal-tab" ref={containerRef} />;
}

function TerminalWindow() {
  const resolvedTheme = useResolvedTheme();
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const [tabState, setTabState] = useState<TerminalTabState>(initialTabs);
  const [activeTab, setActiveTab] = useState(tabState.tabs[0]);
  const initialCwdRef = useRef<string | null>(
    new URLSearchParams(window.location.search).get("cwd"),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accentColor);
  }, [accentColor]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleAddTab = useCallback(() => {
    setTabState((state) => {
      const next = addTab(state);
      setActiveTab(next.tabs[next.tabs.length - 1]);
      return next;
    });
  }, []);

  const handleCloseTab = useCallback(
    (key: string) => {
      const next = removeTab(tabState, key);
      setTabState(next);
      if (next.tabs.length === 0) {
        void getCurrentWindow().close();
      } else {
        setActiveTab((current) => (current === key ? next.tabs[next.tabs.length - 1] : current));
      }
    },
    [tabState],
  );

  return (
    <div className="terminal-window">
      <TitleBar title="Krampus Explorer — Terminal" />
      <div className="terminal-window__tabs">
        {tabState.tabs.map((key, index) => (
          <div
            key={key}
            className={`terminal-window__tab ${key === activeTab ? "terminal-window__tab--active" : ""}`}
          >
            <button type="button" onClick={() => setActiveTab(key)}>
              Shell {index + 1}
            </button>
            <button
              type="button"
              className="terminal-window__tab-close"
              aria-label="Close tab"
              onClick={() => handleCloseTab(key)}
            >
              &#x2715;
            </button>
          </div>
        ))}
        <button type="button" className="terminal-window__new-tab" aria-label="New tab" onClick={handleAddTab}>
          +
        </button>
      </div>
      <div className="terminal-window__body">
        {tabState.tabs.map((key) => (
          // Hidden via CSS rather than unmounted when not the active tab — matches
          // PluginPanel's pattern in ../sidebar/PluginPanel.tsx: a real PTY session is running
          // underneath, and unmounting would kill it just for switching tabs.
          <div
            key={key}
            className="terminal-window__pane"
            style={key === activeTab ? undefined : { display: "none" }}
          >
            <TerminalTabView cwd={key === tabState.tabs[0] ? initialCwdRef.current : null} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default TerminalWindow;
