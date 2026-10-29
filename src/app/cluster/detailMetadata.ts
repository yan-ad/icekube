import type { ResourceKind } from "./api";

export type MetadataEntry = { key: string; value: string };
export type ManagedField = {
  manager: string;
  operation: string;
  apiVersion: string | null;
  time: string | null;
  subresource: string | null;
  fields: string;
};
export type DetailMetadata = {
  labels: MetadataEntry[];
  annotations: MetadataEntry[];
  finalizers: string[];
  managedFields: ManagedField[];
  deletionTimestamp: string | null;
  partial: boolean;
};

const sensitiveKinds = new Set<ResourceKind>(["secrets", "configMaps"]);
const control = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const denied = ["token", "password", "credential", "secret", "authorization", "private", "config", "last-applied", "last_applied", "lastapplied"];
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
// This detects recognizable credential syntax, not arbitrary secrets in prose.
function credentialValue(value: string): boolean {
  return (value.toLowerCase().includes("-----begin") && value.toLowerCase().includes("private key-----"))
    || /(?:^|[^a-z0-9_-])(?:bearer|basic)[^a-z0-9_-]+[a-z0-9_-]+/i.test(value)
    || /(?:^|[^a-z0-9])(?:password|passwd|pwd|token|access_token|client_secret|authorization|credential|private_key|api_key)[ \t"']*[=:]/i.test(value);
}
function unicode(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}
function safe(value: unknown): value is string { return typeof value === "string" && new TextEncoder().encode(value).length <= 1024 && unicode(value) && !control.test(value) && !credentialValue(value); }
function timestamp(value: unknown): value is string {
  if (!safe(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, y, m, d, h, min, sec, , zh, zm] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(h) <= 23 && Number(min) <= 59 && Number(sec) <= 59
    && (zh === undefined || Number(zh) <= 23 && Number(zm) <= 59);
}
function closed(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).every(key => keys.includes(key)); }
function optional(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return safe(value) && value.length > 0 ? value : null;
}
function validFields(value: unknown): value is string {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > 8192 || control.test(value)) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 256) return false;
    const nodes = new Set<string>();
    for (const path of parsed) {
      if (!Array.isArray(path) || path.length === 0 || path.length > 12) return false;
      for (let i = 0; i < path.length; i++) {
        const segment: unknown = path[i];
        if (!safe(segment) || !segment || segment !== "[keyed item]" && (!/^[A-Za-z0-9_./-]+$/.test(segment) || denied.some(fragment => segment.toLowerCase().includes(fragment)))) return false;
        nodes.add(JSON.stringify(path.slice(0, i + 1)));
        if (nodes.size > 255) return false;
      }
    }
    return true;
  } catch { return false; }
}
export function parseDetailMetadata(value: unknown, kind: ResourceKind): DetailMetadata | undefined {
  if (value === undefined) return undefined;
  if (sensitiveKinds.has(kind)) {
    if (value !== null) throw "invalidResponse";
    return undefined;
  }
  if (!record(value) || !closed(value, ["labels", "annotations", "finalizers", "managedFields", "deletionTimestamp", "partial"])
    || !Array.isArray(value.labels) || !Array.isArray(value.annotations) || !Array.isArray(value.finalizers)
    || !Array.isArray(value.managedFields) || typeof value.partial !== "boolean"
    || value.labels.length > 32 || value.annotations.length > 32 || value.finalizers.length > 16 || value.managedFields.length > 8
    || (value.deletionTimestamp !== null && !timestamp(value.deletionTimestamp))) throw "invalidResponse";
  const parseEntries = (items: unknown[]) => items.map(item => {
    if (!record(item) || !closed(item, ["key", "value"]) || !safe(item.key) || item.key.length === 0 || !safe(item.value)
      || denied.some(fragment => String(item.key).toLowerCase().includes(fragment))) throw "invalidResponse";
    return { key: item.key, value: item.value };
  });
  const labels = parseEntries(value.labels);
  const annotations = parseEntries(value.annotations);
  const finalizers = value.finalizers.map(item => { if (!safe(item) || item.length === 0) throw "invalidResponse"; return item; });
  const managedFields = value.managedFields.map(item => {
    if (!record(item) || !closed(item, ["manager", "operation", "apiVersion", "time", "subresource", "fields"])
      || !safe(item.manager) || !safe(item.operation) || !validFields(item.fields) || item.manager.length === 0 || item.operation.length === 0
      || (item.apiVersion !== null && (!safe(item.apiVersion) || !item.apiVersion)) || (item.time !== null && !timestamp(item.time))
      || (item.subresource !== null && (!safe(item.subresource) || !item.subresource))) throw "invalidResponse";
    return { manager: item.manager, operation: item.operation, apiVersion: optional(item.apiVersion), time: optional(item.time), subresource: optional(item.subresource), fields: item.fields };
  });
  const result: DetailMetadata = { labels, annotations, finalizers, managedFields, deletionTimestamp: optional(value.deletionTimestamp), partial: value.partial };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 32 * 1024) throw "invalidResponse";
  return result;
}
