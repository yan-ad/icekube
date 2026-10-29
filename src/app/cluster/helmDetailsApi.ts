import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SessionRequest } from "./api";
import type { HelmCancelRequest, HelmView } from "./helmApi";

export type HelmReference = { view: HelmView; name: string; namespace: string | null; version: string | null };
export type HelmDetailRequest = SessionRequest & HelmReference & { readId: number };
export type HelmHistory = { revision: number; updated: string; status: string; chart: string; appVersion: string };
export type HelmDetail = HelmDetailRequest & { facts: { label: string; value: string }[]; history: HelmHistory[]; truncated: boolean };
const scopeKeys = ["clusterId", "sessionId", "readId", "view"];
const requestKeys = [...scopeKeys, "name", "namespace", "version"];
const encoder = new TextEncoder();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const closed = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(v, key));
// Recognizable credential syntax is withheld; arbitrary secrets in prose cannot be identified.
function credential(value: string): boolean {
  return (value.toLowerCase().includes("-----begin") && value.toLowerCase().includes("private key-----"))
    || /(?:^|[^a-z0-9_-])(?:bearer|basic)[^a-z0-9_-]+[a-z0-9_-]+/i.test(value)
    || /(?:^|[^a-z0-9])(?:password|passwd|pwd|token|access_token|client_secret|authorization|credential|private_key|api_key)[ \t"']*[=:]/i.test(value);
}
function text(v: unknown, multiline = false): v is string {
  if (typeof v !== "string" || encoder.encode(v).length > 4096 || credential(v)
    || /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(v)
    || (multiline ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/).test(v)) return false;
  for (const char of v) {
    const code = char.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}
const namespace = (v: unknown): v is string => typeof v === "string" && v.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(v);
function validScope(request: Record<string, unknown>) {
  return text(request.clusterId) && !!request.clusterId && text(request.sessionId) && !!request.sessionId
    && (request.view === "charts" || request.view === "releases") && typeof request.readId === "number" && Number.isSafeInteger(request.readId) && request.readId > 0;
}
function detailRequest(input: unknown): HelmDetailRequest {
  if (!record(input) || !closed(input, requestKeys) || !validScope(input) || typeof input.name !== "string"
    || !(input.view === "charts"
      ? input.namespace === null && input.name.length <= 253 && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(input.name)
        && typeof input.version === "string" && input.version.length <= 128 && /^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(input.version)
      : namespace(input.namespace) && namespace(input.name) && input.name.length <= 53 && input.version === null)) throw "invalidInput";
  return { clusterId: input.clusterId as string, sessionId: input.sessionId as string, readId: input.readId as number,
    view: input.view as HelmView, name: input.name, namespace: input.namespace as string | null, version: input.version as string | null };
}
export function parseHelmDetail(value: unknown, input: unknown): HelmDetail {
  const request = detailRequest(input);
  if (!record(value) || !closed(value, [...requestKeys, "facts", "history", "truncated"])
    || Object.entries(request).some(([key, expected]) => value[key] !== expected)
    || typeof value.truncated !== "boolean" || !Array.isArray(value.facts) || value.facts.length > 200
    || !Array.isArray(value.history) || value.history.length > 100
    || request.view === "charts" && value.history.length !== 0 || request.view === "releases" && value.facts.length !== 0) throw "invalidResponse";
  let bytes = 0;
  const facts: HelmDetail["facts"] = [];
  const history: HelmHistory[] = [];
  for (const fact of value.facts) {
    if (!record(fact) || !closed(fact, ["label", "value"]) || !text(fact.label) || !fact.label || !text(fact.value, true)) throw "invalidResponse";
    // Rust budgets projected values, not labels, identities or JSON serialization.
    bytes += encoder.encode(fact.value).length;
    facts.push({ label: fact.label, value: fact.value });
  }
  const revisions = new Set<number>();
  for (const row of value.history) {
    if (!record(row) || !closed(row, ["revision", "updated", "status", "chart", "appVersion"])
      || typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision <= 0 || row.revision > 4294967295 || revisions.has(row.revision)
      || !text(row.updated) || !text(row.status) || !row.status || !text(row.chart) || !row.chart || !text(row.appVersion)) throw "invalidResponse";
    revisions.add(row.revision);
    bytes += encoder.encode(row.updated + row.status + row.chart + row.appVersion).length;
    history.push({ revision: row.revision, updated: row.updated, status: row.status, chart: row.chart, appVersion: row.appVersion });
  }
  if (bytes > 64 * 1024) throw "invalidResponse";
  return { ...request, facts, history, truncated: value.truncated };
}
export async function loadHelmDetail(input: unknown): Promise<HelmDetail> {
  const request = detailRequest(input);
  if (!isTauri()) throw "connectionFailed";
  return parseHelmDetail(await invoke<unknown>("helm_detail", { request }), request);
}
export async function cancelHelmDetail(input: unknown): Promise<void> {
  if (!record(input) || !closed(input, scopeKeys) || !validScope(input)) throw "invalidInput";
  const request: HelmCancelRequest = { clusterId: input.clusterId as string, sessionId: input.sessionId as string, view: input.view as HelmView, readId: input.readId as number };
  if (!isTauri()) return;
  const result = await invoke<unknown>("helm_detail_cancel", { request });
  if (result !== undefined && result !== null) throw "invalidResponse";
}
