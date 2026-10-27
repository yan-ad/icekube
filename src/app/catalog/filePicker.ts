import { invoke, isTauri } from "@tauri-apps/api/core";

export const filePickerError = "The file dialog could not be opened. Try again or enter the kubeconfig path.";

export async function chooseKubeconfig(): Promise<string | null> {
  if (!isTauri()) throw new Error(filePickerError);
  try {
    const result: unknown = await invoke("catalog_choose_kubeconfig");
    if (result === null) return null;
    if (typeof result !== "string" || !result || result.includes("\0")) {
      throw new Error(filePickerError);
    }
    return result;
  } catch {
    throw new Error(filePickerError);
  }
}
