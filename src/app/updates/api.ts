import { invoke, isTauri } from "@tauri-apps/api/core";
import { getWindowLayout } from "../layouts/window-layout";

export type UpdatePhase = "disabled" | "idle" | "checking" | "downloading" | "ready" | "preparing" | "restarting" | "error" | "stopped";
export type UpdateSnapshot = { phase: UpdatePhase; version: string | null; error: string | null; preparationId?: string; progress?: { downloaded: number; total: number } | null };
const phases = new Set<UpdatePhase>(["disabled", "idle", "checking", "downloading", "ready", "preparing", "restarting", "error", "stopped"]);
const errors = new Set(["unavailable", "trustNotConfigured", "invalidProxy", "checkFailed", "downloadFailed", "limitExceeded", "timedOut", "invalidRelease", "verificationFailed", "installFailed", "notReady", "busy", "stopped"]);
export function hasUpdateEngine(): boolean {
  if (typeof window === "undefined" || !isTauri()) return false;
  const platform = getWindowLayout().platform;
  return platform === "macos" || platform === "windows";
}
export async function reportUpdateWindowPrepared(attempt: string, ready: boolean): Promise<void> {
  if (!hasUpdateEngine()) return;
  if (!/^[0-9a-f]{32}$/.test(attempt)) throw "invalidResponse";
  await invoke<void>("update_window_prepared", { attempt, ready });
}
export const disabledUpdateSnapshot: UpdateSnapshot = { phase: "disabled", version: null, error: null };
export function parseUpdateSnapshot(value: unknown): UpdateSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw "invalidResponse";
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !["phase", "version", "error", "progress", "preparationId"].includes(key))) throw "invalidResponse";
  const { phase, version, error } = item;
  if (!phases.has(phase as UpdatePhase) || !(version === null || (typeof version === "string" && version.length <= 50 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))) || !(error === null || (typeof error === "string" && errors.has(error))) || ((phase === "ready" || phase === "restarting") && !version)) throw "invalidResponse";
  const snapshot: UpdateSnapshot = { phase: phase as UpdatePhase, version: version as string | null, error: error as string | null };
  if (phase === "preparing") {
    if (!version || typeof item.preparationId !== "string" || !/^[0-9a-f]{32}$/.test(item.preparationId)) throw "invalidResponse";
    snapshot.preparationId = item.preparationId;
  } else if (item.preparationId !== undefined) throw "invalidResponse";
  if (item.progress !== undefined) {
    if (item.progress === null) return { ...snapshot, progress: null };
    const progress = item.progress;
    if (typeof progress !== "object" || Array.isArray(progress) || Object.keys(progress).some(key => key !== "downloaded" && key !== "total")) throw "invalidResponse";
    const { downloaded, total } = progress as Record<string, unknown>;
    if (typeof downloaded !== "number" || typeof total !== "number" || !Number.isSafeInteger(downloaded) || !Number.isSafeInteger(total) || downloaded < 0 || total < downloaded || total > 256 * 1024 * 1024) throw "invalidResponse";
    snapshot.progress = { downloaded, total };
  }
  return snapshot;
}
export async function readUpdateState(): Promise<UpdateSnapshot> {
  if (!hasUpdateEngine()) return disabledUpdateSnapshot;
  return parseUpdateSnapshot(await invoke<unknown>("update_state"));
}
export async function reportUpdateWindowReady(ready: boolean): Promise<void> {
  if (!hasUpdateEngine()) return;
  await invoke<void>("update_window_ready", { ready });
}
export function updateError(reason: unknown): string {
  if (reason === "verificationFailed") return "The update could not be verified. It was not installed.";
  if (reason === "installFailed") return "The update could not be installed. Try checking again.";
  if (reason === "busy") return "An update operation is already in progress.";
  if (reason === "limitExceeded") return "The release exceeds the download size limit.";
  if (reason === "invalidRelease") return "The release is not a supported update.";
  return "The update could not be completed. Try checking again.";
}
