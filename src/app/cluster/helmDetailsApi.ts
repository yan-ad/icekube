import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SessionRequest } from "./api";
import type { HelmCancelRequest, HelmView } from "./helmApi";

export type HelmReference = { view: HelmView; name: string; namespace: string | null; version: string | null };
export type HelmDetailRequest = SessionRequest & HelmReference & { readId: number };
export type HelmHistory = { revision: number; updated: string; status: string; chart: string; appVersion: string };
export type HelmDetail = HelmDetailRequest & { facts: { label: string; value: string }[]; history: HelmHistory[]; truncated: boolean };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 4096 && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(v);
const namespace = (v: unknown): v is string => typeof v === "string" && v.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(v);
function validScope(request: HelmCancelRequest) {
  return text(request.clusterId) && !!request.clusterId && text(request.sessionId) && !!request.sessionId
    && (request.view === "charts" || request.view === "releases") && Number.isSafeInteger(request.readId) && request.readId > 0;
}
export async function loadHelmDetail(input: HelmDetailRequest): Promise<HelmDetail> {
  const request = { ...input };
  if (!validScope(request) || !(request.view === "charts"
    ? request.namespace === null && request.name.length <= 253 && /^[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(request.name)
      && typeof request.version === "string" && request.version.length <= 128 && /^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(request.version)
    : namespace(request.namespace) && namespace(request.name) && request.name.length <= 53 && request.version === null)) throw "invalidInput";
  if (!isTauri()) throw "connectionFailed";
  const value = await invoke<unknown>("helm_detail", { request });
  if (!record(value) || Object.entries(request).some(([key, expected]) => value[key] !== expected)
    || typeof value.truncated !== "boolean" || !Array.isArray(value.facts) || value.facts.length > 200
    || !Array.isArray(value.history) || value.history.length > 100
    || request.view === "charts" && value.history.length !== 0 || request.view === "releases" && value.facts.length !== 0) throw "invalidResponse";
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const fact of value.facts) {
    if (!record(fact) || !text(fact.label) || !text(fact.value)) throw "invalidResponse";
    bytes += encoder.encode(fact.value).length;
  }
  const revisions = new Set<number>();
  for (const row of value.history) {
    if (!record(row) || typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision <= 0 || row.revision > 4294967295 || revisions.has(row.revision)
      || !text(row.updated) || !text(row.status) || !text(row.chart) || !text(row.appVersion)) throw "invalidResponse";
    revisions.add(row.revision);
    bytes += encoder.encode(row.updated + row.status + row.chart + row.appVersion).length;
  }
  if (bytes > 64 * 1024) throw "invalidResponse";
  return value as HelmDetail;
}
export async function cancelHelmDetail(request: HelmCancelRequest): Promise<void> {
  if (!validScope(request)) throw "invalidInput";
  if (!isTauri()) return;
  const result = await invoke<unknown>("helm_detail_cancel", { request });
  if (result !== undefined && result !== null) throw "invalidResponse";
}
