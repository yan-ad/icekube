import { invoke, isTauri } from "@tauri-apps/api/core";

export const projectOpenError = "The GitHub repository could not be opened. Check your operating system's default browser setting and try again.";

export function hasProjectEngine(): boolean { return isTauri(); }

export async function openProjectRepository(): Promise<void> {
  if (!hasProjectEngine()) throw "unavailable";
  await invoke<void>("project_open_repository", {});
}
