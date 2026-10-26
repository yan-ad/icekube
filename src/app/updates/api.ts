import { invoke, isTauri } from "@tauri-apps/api/core";

export type UpdatePhase = "disabled" | "idle" | "checking" | "downloading" | "ready" | "restarting" | "error" | "stopped";
export type UpdateSnapshot = { phase: UpdatePhase; version: string | null; error: string | null };
const phases = new Set<UpdatePhase>(["disabled", "idle", "checking", "downloading", "ready", "restarting", "error", "stopped"]);
const errors = new Set(["unavailable", "trustNotConfigured", "invalidProxy", "checkFailed", "downloadFailed", "limitExceeded", "timedOut", "invalidRelease", "verificationFailed", "installFailed", "notReady", "busy", "stopped"]);
export const hasUpdateEngine = isTauri;
export function parseUpdateSnapshot(value: unknown): UpdateSnapshot {
  if (!value || typeof value !== "object") throw "invalidResponse";
  const item = value as UpdateSnapshot;
  if (!phases.has(item.phase) || !(item.version === null || (typeof item.version === "string" && item.version.length <= 100 && /^[0-9A-Za-z.+-]+$/.test(item.version))) || !(item.error === null || errors.has(item.error)) || ((item.phase === "ready" || item.phase === "restarting") && !item.version)) throw "invalidResponse";
  return { phase: item.phase, version: item.version, error: item.error };
}
export async function readUpdateState(): Promise<UpdateSnapshot> {
  if (!hasUpdateEngine()) return { phase: "disabled", version: null, error: null };
  return parseUpdateSnapshot(await invoke<unknown>("update_state"));
}
export async function restartUpdate(): Promise<void> {
  if (!hasUpdateEngine()) throw "unavailable";
  await invoke<void>("update_restart");
}
export function updateError(reason: unknown): string {
  if (reason === "trustNotConfigured") return "Updates are disabled until a release signing public key is configured.";
  if (reason === "verificationFailed") return "The update signature could not be verified. Nothing was installed.";
  if (reason === "installFailed") return "The update could not be installed. The app has not restarted.";
  if (reason === "busy") return "An update restart is already in progress.";
  return "The update could not be completed. The app has not restarted.";
}
