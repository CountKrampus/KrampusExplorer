import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import TitleBar from "./components/TitleBar";
import Toolbar from "./components/Toolbar";
import StatusBar from "./components/StatusBar";
import Sidebar from "./sidebar/Sidebar";
import Explorer from "./explorer/Explorer";
import PreviewPane from "./preview/PreviewPane";
import ConflictDialog from "./components/ConflictDialog";
import TransferProgress from "./components/TransferProgress";
import ToastContainer from "./components/ToastContainer";
import SettingsPanel from "./settings/SettingsPanel";
import { useActiveTab, useExplorerStore } from "./stores/useExplorerStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { usePluginStore } from "./stores/usePluginStore";
import { useUpdateStore } from "./stores/useUpdateStore";
import { useTabFetcher } from "./hooks/useTabFetcher";
import { useResolvedTheme } from "./hooks/useResolvedTheme";
import "./styles/theme.css";
import "./styles/global.css";
import "./App.css";

function App() {
  const tabs = useExplorerStore((state) => state.tabs);
  const newTab = useExplorerStore((state) => state.newTab);
  const resolvedTheme = useResolvedTheme();
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const settingsLoaded = useSettingsStore((state) => state.loaded);
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const startupMode = useSettingsStore((state) => state.startupMode);
  const startupCustomPath = useSettingsStore((state) => state.startupCustomPath);
  const lastLocation = useSettingsStore((state) => state.lastLocation);
  const setLastLocation = useSettingsStore((state) => state.setLastLocation);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const activeTab = useActiveTab();

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accentColor);
  }, [accentColor]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const loadPlugins = usePluginStore((state) => state.loadPlugins);

  useEffect(() => {
    // Waits for settings to load first so `disabledPlugins` is known before any plugin entry
    // script runs — otherwise a disabled plugin could still execute during the race window
    // before settings finish loading.
    if (!settingsLoaded) return;
    void loadPlugins();
  }, [settingsLoaded, loadPlugins]);

  useEffect(() => {
    if (tabs.length !== 0 || !settingsLoaded) return;

    let startPath: Promise<string>;
    if (startupMode === "custom" && startupCustomPath) {
      startPath = Promise.resolve(startupCustomPath);
    } else if (startupMode === "last" && lastLocation) {
      startPath = Promise.resolve(lastLocation);
    } else {
      startPath = invoke<string>("get_default_start_path");
    }

    startPath
      .then((path) => {
        if (useExplorerStore.getState().tabs.length === 0) {
          newTab(path);
        }
      })
      .catch((error: string) => {
        setBootstrapError(String(error));
      });
  }, [tabs.length, settingsLoaded, startupMode, startupCustomPath, lastLocation, newTab]);

  useEffect(() => {
    const currentPath = activeTab?.history[activeTab.historyIndex];
    if (currentPath) setLastLocation(currentPath);
  }, [activeTab?.history, activeTab?.historyIndex, setLastLocation]);

  useTabFetcher();

  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  useEffect(() => {
    // Silent on startup — no toast/dialog interrupts the user. Settings -> Updates shows the
    // result once the check resolves, and offers a manual "Check for Updates" button too.
    void checkForUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (tabs.length === 0) {
    return (
      <div className="app">
        <TitleBar />
        <div className="app-loading">
          {bootstrapError ? `Failed to start: ${bootstrapError}` : "Loading…"}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <TitleBar />
      <Toolbar />
      <div className="app__body">
        <Sidebar />
        <Explorer />
        <PreviewPane />
      </div>
      <StatusBar />
      <ConflictDialog />
      <TransferProgress />
      <SettingsPanel />
      <ToastContainer />
    </div>
  );
}

export default App;
