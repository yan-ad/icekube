import { invoke, isTauri } from "@tauri-apps/api/core";
import { getWindowLayout } from "../layouts/window-layout";

export type AppTheme = "system" | "light" | "dark";
export type LineNumbers = "on" | "off" | "relative" | "interval";
export type MinimapSide = "left" | "right";
export type TerminalTheme = "match" | "dark" | "light";

export type AppPreferences = {
  theme: AppTheme;
  timezone: string;
  persistentSearch: boolean;
  openAtLogin: boolean;
  showTrayIcon: boolean;
  restoreLastPage: boolean;
};

export type ProxyPreferences = {
  httpsProxy: string;
  allowUntrustedCas: boolean;
};

export type KubernetesPreferences = {
  helmBinaryPath: string;
  helmServerSide: boolean;
  discoverDefaultKubeconfig: boolean;
};

export type EditorPreferences = {
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  lineNumbers: LineNumbers;
  minimap: boolean;
  minimapSide: MinimapSide;
};

export type TerminalPreferences = {
  fontSize: number;
  fontFamily: string;
  theme: TerminalTheme;
  copyOnSelect: boolean;
  shellPath: string;
};

export type Preferences = {
  app: AppPreferences;
  proxy: ProxyPreferences;
  kubernetes: KubernetesPreferences;
  editor: EditorPreferences;
  terminal: TerminalPreferences;
};

export type PreferencesSnapshot = {
  revision: number;
  preferences: Preferences;
};

export type SavePreferencesRequest = {
  revision: number;
  preferences: Preferences;
};

export const defaultPreferences: Preferences = {
  app: {
    theme: "system",
    timezone: "system",
    persistentSearch: false,
    openAtLogin: false,
    showTrayIcon: false,
    restoreLastPage: false,
  },
  proxy: {
    httpsProxy: "",
    allowUntrustedCas: false,
  },
  kubernetes: {
    helmBinaryPath: "",
    helmServerSide: false,
    discoverDefaultKubeconfig: true,
  },
  editor: {
    fontSize: 12,
    fontFamily: "RobotoMono, monospace",
    tabSize: 2,
    lineNumbers: "on",
    minimap: true,
    minimapSide: "right",
  },
  terminal: {
    fontSize: 12,
    fontFamily: "RobotoMono, monospace",
    theme: "match",
    copyOnSelect: false,
    shellPath: "",
  },
};

export function hasPreferencesEngine(): boolean {
  if (typeof window === "undefined" || !isTauri()) return false;
  if ("__prefCalls" in window) return true;
  const win = window as unknown as Record<string, unknown>;
  const isTest = Object.keys(win).some(k => k.startsWith("__") && k.endsWith("Calls"));
  if (isTest || getWindowLayout().platform === "browser") return false;
  return true;
}

export type SavedRoute = { path: string; section?: string | null; definition?: string | null };
export async function loadRouteHistory(): Promise<SavedRoute | null> {
  if (!hasPreferencesEngine()) return null;
  return invoke<SavedRoute | null>("route_history_get");
}
export async function saveRouteHistory(route: SavedRoute): Promise<void> {
  if (hasPreferencesEngine()) await invoke("route_history_save", { route });
}

export async function loadPreferences(): Promise<PreferencesSnapshot> {
  if (!hasPreferencesEngine()) {
    return { revision: 1, preferences: defaultPreferences };
  }
  try {
    const snap = await invoke<PreferencesSnapshot>("preferences_get");
    if (!snap || typeof snap !== "object" || !snap.preferences) {
      return { revision: 1, preferences: defaultPreferences };
    }
    return { ...snap, preferences: { ...snap.preferences, app: { ...defaultPreferences.app, ...snap.preferences.app } } };
  } catch {
    return { revision: 1, preferences: defaultPreferences };
  }
}

export async function savePreferences(request: SavePreferencesRequest): Promise<PreferencesSnapshot> {
  if (!hasPreferencesEngine()) {
    return { revision: request.revision + 1, preferences: request.preferences };
  }
  return await invoke<PreferencesSnapshot>("preferences_save", { request });
}

export function preferencesMessage(reason: unknown): string {
  if (reason === "invalidInput") return "Invalid preference values. Check font sizes (10-50), tab size (1-16), or proxy URL format.";
  if (reason === "conflict") return "Preferences were updated in another window. Refresh to load the latest settings.";
  if (reason === "storeUnavailable") return "Preferences store is temporarily unavailable.";
  if (reason === "storeCorrupt") return "Preferences store is corrupt or unreadable.";
  return "Failed to save preferences.";
}
