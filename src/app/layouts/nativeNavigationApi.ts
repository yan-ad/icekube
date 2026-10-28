import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { disabledUpdateSnapshot, hasUpdateEngine, parseUpdateSnapshot, type UpdateSnapshot } from "../updates/api";
import { getWindowLayout } from "./window-layout";

export const NATIVE_NAVIGATION_EVENT = "iceon://native-navigation";
export type NativeAction = "allCategories" | "openSearch" | "openPreferences" | "checkUpdates";
export function isNativeAction(value: unknown): value is NativeAction {
  return value === "allCategories" || value === "openSearch" || value === "openPreferences" || value === "checkUpdates";
}

export async function subscribeNativeNavigation(onAction: (action: NativeAction) => void): Promise<() => void> {
  if (!isTauri() || getWindowLayout().platform === "browser") return () => {};
  let active = true;
  const unlisten = await getCurrentWebviewWindow().listen<unknown>(NATIVE_NAVIGATION_EVENT, ({ payload }) => {
    if (active && isNativeAction(payload)) onAction(payload);
  });
  try { await invoke<void>("native_navigation_ready"); }
  catch (error) { active = false; unlisten(); throw error; }
  return () => { active = false; unlisten(); };
}

export async function checkForUpdates(): Promise<UpdateSnapshot> {
  if (!hasUpdateEngine()) return disabledUpdateSnapshot;
  return parseUpdateSnapshot(await invoke<unknown>("update_check"));
}
