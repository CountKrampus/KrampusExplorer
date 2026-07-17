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

/** Label shown in the tab strip for a given tab's shell — falls back to a generic "Shell N"
 * label for the default/auto-detected shell, since we don't know which one that resolved to
 * without asking the backend. */
function tabLabel(shell: string | null, index: number): string {
  if (shell === "powershell.exe") return "PowerShell";
  if (shell === "cmd.exe") return "CMD";
  return `Shell ${index + 1}`;
}

interface TerminalChunk {
  data: string;
}

interface TerminalTabProps {
  cwd: string | null;
  shell: string | null;
}

function TerminalTabView({ cwd, shell }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({ convertEol: true, fontSize: 13 });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    let sessionId: string | null = null;
    let cancelled = false;
    let disposed = false;

    // fitAddon.fit() needs the container to have a real layout size, which it doesn't have
    // synchronously right after term.open() — the browser hasn't painted yet. Deferring to the
    // next animation frame avoids xterm's renderer throwing on undefined dimensions.
    const fitFrame = requestAnimationFrame(() => {
      if (!disposed) fitAddon.fit();
    });

    const onOutput = new Channel<TerminalChunk>();
    onOutput.onmessage = (chunk) => {
      if (!disposed) term.write(chunk.data);
    };

    invoke<string>("terminal_spawn", { cwd, shell, onOutput })
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
      cancelAnimationFrame(fitFrame);
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
  const [activeTab, setActiveTab] = useState(tabState.tabs[0].key);
  const [initialCwd, setInitialCwd] = useState<string | null>(null);
  const [initialCwdLoaded, setInitialCwdLoaded] = useState(false);

  useEffect(() => {
    invoke<string | null>("take_pending_terminal_cwd").then((cwd) => {
      setInitialCwd(cwd);
      setInitialCwdLoaded(true);
    });
  }, []);

  const [isElevated, setIsElevated] = useState(false);

  useEffect(() => {
    invoke<boolean>("is_elevated")
      .then(setIsElevated)
      .catch(() => {
        // Default to false (not elevated) if the check itself fails for some reason -- the
        // title label is cosmetic, not a security boundary, so failing closed here just means
        // a possibly-misleading title, not a real risk.
      });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accentColor);
  }, [accentColor]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleAddTab = useCallback(
    (shell: string | null = null) => {
      const next = addTab(tabState, shell);
      setTabState(next);
      setActiveTab(next.tabs[next.tabs.length - 1].key);
    },
    [tabState],
  );

  const handleCloseTab = useCallback(
    (key: string) => {
      const next = removeTab(tabState, key);
      setTabState(next);
      if (next.tabs.length === 0) {
        void getCurrentWindow().close();
      } else {
        setActiveTab((current) =>
          current === key ? next.tabs[next.tabs.length - 1].key : current,
        );
      }
    },
    [tabState],
  );

  return (
    <div className="terminal-window">
      <TitleBar
        title={
          isElevated
            ? "Krampus Explorer — Terminal (Administrator)"
            : "Krampus Explorer — Terminal"
        }
      />
      <div className="terminal-window__tabs">
        {tabState.tabs.map((tab, index) => (
          <div
            key={tab.key}
            className={`terminal-window__tab ${tab.key === activeTab ? "terminal-window__tab--active" : ""}`}
          >
            <button type="button" onClick={() => setActiveTab(tab.key)}>
              {tabLabel(tab.shell, index)}
            </button>
            <button
              type="button"
              className="terminal-window__tab-close"
              aria-label="Close tab"
              onClick={() => handleCloseTab(tab.key)}
            >
              &#x2715;
            </button>
          </div>
        ))}
        <button
          type="button"
          className="terminal-window__new-tab"
          aria-label="New PowerShell tab"
          title="New PowerShell tab"
          onClick={() => handleAddTab("powershell.exe")}
        >
          + PS
        </button>
        <button
          type="button"
          className="terminal-window__new-tab"
          aria-label="New Command Prompt tab"
          title="New Command Prompt tab"
          onClick={() => handleAddTab("cmd.exe")}
        >
          + CMD
        </button>
      </div>
      <div className="terminal-window__body">
        {initialCwdLoaded &&
          tabState.tabs.map((tab) => (
            // Hidden via CSS rather than unmounted when not the active tab — matches
            // PluginPanel's pattern in ../sidebar/PluginPanel.tsx: a real PTY session is running
            // underneath, and unmounting would kill it just for switching tabs.
            <div
              key={tab.key}
              className="terminal-window__pane"
              style={tab.key === activeTab ? undefined : { display: "none" }}
            >
              <TerminalTabView
                cwd={tab.key === tabState.tabs[0].key ? initialCwd : null}
                shell={tab.shell}
              />
            </div>
          ))}
      </div>
    </div>
  );
}

export default TerminalWindow;
