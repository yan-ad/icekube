import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Theme } from "@astryxdesign/core/theme";
import { brandTheme } from "../../themes/brand";
import { getWindowLayout } from "../layouts/window-layout";
import { defaultPreferences, loadPreferences, savePreferences as apiSavePreferences, type Preferences, type PreferencesSnapshot } from "./api";

type PreferencesContextType = {
  preferences: Preferences;
  revision: number;
  isOpen: boolean;
  openPreferences: () => void;
  closePreferences: () => void;
  save: (next: Preferences) => Promise<void>;
  reset: () => Promise<void>;
  preferencesReady: boolean;
};

const PreferencesContext = createContext<PreferencesContextType | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PreferencesSnapshot>({
    revision: 1,
    preferences: defaultPreferences,
  });
  const [isOpen, setIsOpen] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const snap = await loadPreferences();
      if (snap && snap.preferences) {
        setSnapshot(snap);
      }
    } catch {
      // Keep existing snapshot on error
    } finally {
      setPreferencesReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauri() || getWindowLayout().platform !== "macos") return;

    let disposed = false;
    const subscription = listen<void>("iceon://open-preferences", () => {
      if (!disposed) setIsOpen(true);
    }, { target: { kind: "WebviewWindow", label: "main" } });

    void subscription.catch(() => {
      console.error("Could not listen for the native Preferences menu.");
    });
    return () => {
      disposed = true;
      void subscription.then(unlisten => unlisten()).catch(() => {
        console.error("Could not clean up the native Preferences menu listener.");
      });
    };
  }, []);

  // Global shortcut: Cmd+, or Ctrl+, opens preferences
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "," && !e.repeat) {
        e.preventDefault();
        setIsOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Update CSS variables for editor and terminal
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-font-size", `${snapshot.preferences.editor.fontSize}px`);
    root.style.setProperty("--editor-font-family", snapshot.preferences.editor.fontFamily);
    root.style.setProperty("--editor-tab-size", String(snapshot.preferences.editor.tabSize));
    root.style.setProperty("--terminal-font-size", `${snapshot.preferences.terminal.fontSize}px`);
    root.style.setProperty("--terminal-font-family", snapshot.preferences.terminal.fontFamily);
  }, [snapshot.preferences]);

  const save = useCallback(async (next: Preferences) => {
    const updated = await apiSavePreferences({
      revision: snapshot.revision,
      preferences: next,
    });
    setSnapshot(updated);
  }, [snapshot.revision]);

  const reset = useCallback(async () => {
    const updated = await apiSavePreferences({
      revision: snapshot.revision,
      preferences: defaultPreferences,
    });
    setSnapshot(updated);
  }, [snapshot.revision]);

  return (
    <PreferencesContext.Provider
      value={{
        preferences: snapshot.preferences,
        revision: snapshot.revision,
        isOpen,
        openPreferences: () => setIsOpen(true),
        closePreferences: () => setIsOpen(false),
        save,
        reset,
        preferencesReady,
      }}
    >
      <Theme theme={brandTheme} mode={snapshot.preferences.app.theme}>
        {children}
      </Theme>
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return context;
}
