import { invoke, isTauri } from "@tauri-apps/api/core";
import { connectionMessage, errorCode, type SessionRequest } from "./api";

export type HelmView = "charts" | "releases";
export type HelmCancelRequest = SessionRequest & { view: HelmView; readId: number };
export type HelmRequest = HelmCancelRequest & { namespace: string | null };
export type HelmItem = {
  id: string; name: string; namespace: string | null; version: string; appVersion: string;
  description: string | null; status: string | null; revision: number | null; updated: string | null;
};
export type HelmPage = HelmRequest & { items: HelmItem[]; truncated: boolean };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 4096 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const optionalText = (value: unknown) => value === null || text(value);
const validNamespace = (value: unknown): value is string => typeof value === "string" && value.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value);
const validScope = (request: HelmCancelRequest) => text(request.clusterId) && !!request.clusterId && text(request.sessionId) && !!request.sessionId
  && (request.view === "charts" || request.view === "releases") && Number.isSafeInteger(request.readId) && request.readId > 0;
export async function cancelHelm(request: HelmCancelRequest): Promise<void> {
  if (!validScope(request)) throw "invalidInput";
  if (!isTauri()) return;
  const result = await invoke<unknown>("helm_cancel", { request });
  if (result !== undefined && result !== null) throw "invalidResponse";
}
export function helmMessage(reason: unknown): string {
  if (reason === "helmUnavailable") return "Helm is not installed or is not executable on the desktop app's PATH. Install Helm and restart Icekube, then reload.";
  if (reason === "conflict") return "Helm could not read this inventory. Check your local Helm repository configuration or the saved context's access using your trusted CLI, then reload. Helm diagnostic output is withheld because it may contain credentials.";
  return connectionMessage(errorCode(reason));
}
export async function loadHelm(request: HelmRequest): Promise<HelmPage> {
  request = { ...request };
  if (!validScope(request) || !(request.namespace === null || request.view === "releases" && validNamespace(request.namespace))) throw "invalidInput";
  if (!isTauri()) throw "connectionFailed";
  const value = await invoke<unknown>("helm_table", { request });
  if (!record(value) || value.clusterId !== request.clusterId || value.sessionId !== request.sessionId || value.view !== request.view
    || value.readId !== request.readId || value.namespace !== request.namespace
    || typeof value.truncated !== "boolean" || !Array.isArray(value.items) || value.items.length > 500) throw "invalidResponse";
  const ids = new Set<string>();
  for (const row of value.items) {
    if (!record(row) || !text(row.id) || !row.id || ids.has(row.id) || !text(row.name) || !row.name
      || !text(row.version) || !text(row.appVersion) || !optionalText(row.namespace) || !optionalText(row.description)
      || !optionalText(row.status) || !optionalText(row.updated)
      || !(row.revision === null || typeof row.revision === "number" && Number.isInteger(row.revision) && row.revision >= 0 && row.revision <= 4294967295)
      || (request.view === "releases" && (!validNamespace(row.namespace) || !row.status || row.revision === null || row.description !== null || row.updated === null))
      || (request.view === "charts" && (row.namespace !== null || row.status !== null || row.revision !== null || row.updated !== null || row.description === null))
      || (request.namespace !== null && row.namespace !== request.namespace)) throw "invalidResponse";
    ids.add(row.id);
  }
  return value as HelmPage;
}
