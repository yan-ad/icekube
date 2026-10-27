import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { parseUpdateSnapshot, type UpdateSnapshot } from "../updates/api";

export const NATIVE_NAVIGATION_EVENT = "icekube://native-navigation";
export type NativeAction = "allCategories" | "openSearch" | "openPreferences" | "checkUpdates";
export function isNativeAction(value: unknown): value is NativeAction {
  return value === "allCategories" || value === "openSearch" || value === "openPreferences" || value === "checkUpdates";
}

export async function subscribeNativeNavigation(onAction: (action: NativeAction) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  let active = true;
  const unlisten = await getCurrentWebviewWindow().listen<unknown>(NATIVE_NAVIGATION_EVENT, ({ payload }) => {
    if (active && isNativeAction(payload)) onAction(payload);
  });
  try { await invoke<void>("native_navigation_ready"); }
  catch (error) { active = false; unlisten(); throw error; }
  return () => { active = false; unlisten(); };
}

export async function checkForUpdates(): Promise<UpdateSnapshot> {
  if (!isTauri()) return { phase: "disabled", version: null, error: null };
  return parseUpdateSnapshot(await invoke<unknown>("update_check"));
}
