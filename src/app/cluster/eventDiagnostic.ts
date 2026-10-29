import type { ResourceKind } from "./api";

export type EventDiagnostic = {
  message: string;
  truncated: boolean;
  source: string | null;
  fieldPath: string | null;
};

const maxBytes = 8 * 1024;
const forbidden = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
// Recognizable syntax only: arbitrary secrets in server-authored prose cannot be detected reliably.
function credential(value: string): boolean {
  return /-----begin[^\n]*private key-----/i.test(value)
    || /(?:^|[^a-z0-9_-])(?:bearer|basic)[^a-z0-9_-]+[a-z0-9_-]+/i.test(value)
    || /(?:^|[^a-z0-9])(?:password|passwd|pwd|token|access_token|client_secret|authorization|credential|private_key|api_key)[ \t"']*[=:]/i.test(value);
}
function safe(value: unknown, limit: number): value is string {
  if (typeof value !== "string" || value.length > limit || forbidden.test(value) || credential(value)) return false;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return new TextEncoder().encode(value).length <= limit;
}

export function parseEventDiagnostic(value: unknown, kind: ResourceKind): EventDiagnostic | undefined {
  if (value === undefined) return undefined;
  if (kind !== "events") {
    if (value !== null) throw "invalidResponse";
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw "invalidResponse";
  const diagnostic = value as Record<string, unknown>;
  if (Object.keys(diagnostic).length !== 4
    || !Object.keys(diagnostic).every(key => ["message", "truncated", "source", "fieldPath"].includes(key))
    || !safe(diagnostic.message, maxBytes) || typeof diagnostic.truncated !== "boolean"
    || !(diagnostic.source === null || safe(diagnostic.source, 1024) && diagnostic.source.length > 0)
    || !(diagnostic.fieldPath === null || safe(diagnostic.fieldPath, 1024) && diagnostic.fieldPath.length > 0)) throw "invalidResponse";
  const result: EventDiagnostic = { message: diagnostic.message, truncated: diagnostic.truncated,
    source: diagnostic.source, fieldPath: diagnostic.fieldPath };
  if (new TextEncoder().encode(result.message + (result.source ?? "") + (result.fieldPath ?? "")).length > maxBytes) throw "invalidResponse";
  return result;
}
