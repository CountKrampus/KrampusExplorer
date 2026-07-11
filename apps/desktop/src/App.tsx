import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import TitleBar from "./components/TitleBar";
import Toolbar from "./components/Toolbar";
import StatusBar from "./components/StatusBar";
import Sidebar from "./sidebar/Sidebar";
import Explorer from "./explorer/Explorer";
import PreviewPane from "./preview/PreviewPane";
import ConflictDialog from "./components/ConflictDialog";
import SettingsPanel from "./settings/SettingsPanel";
import { useExplorerStore } from "./stores/useExplorerStore";
import { useSettingsStore } from "./stores/useSettingsStore";
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
  const accentColor = useSettingsStore((state) => state.accentColor);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accentColor);
  }, [accentColor]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (tabs.length !== 0 || !settingsLoaded) return;

    const startPath =
      startupMode === "custom" && startupCustomPath
        ? Promise.resolve(startupCustomPath)
        : invoke<string>("get_default_start_path");

    startPath
      .then((path) => {
        if (useExplorerStore.getState().tabs.length === 0) {
          newTab(path);
        }
      })
      .catch((error: string) => {
        setBootstrapError(String(error));
      });
  }, [tabs.length, settingsLoaded, startupMode, startupCustomPath, newTab]);

  useTabFetcher();

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
      <SettingsPanel />
    </div>
  );
}

export default App;
