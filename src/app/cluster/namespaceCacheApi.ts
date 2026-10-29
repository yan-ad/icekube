import { invoke, hasEngine as isTauri } from "../engine";
import { errorCode, type SessionRequest } from "./api";

export const NAMESPACE_LIMIT = 1_000;
export const validNamespace = (value: string) => value.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value);
export type NamespaceSnapshot = SessionRequest & {
  names: string[];
  fetchedAt: number;
  expiresAt: number;
  partial: boolean;
};
export type NamespaceRefreshRequest = SessionRequest & { readId: number };
const MAX_TTL = 24 * 60 * 60 * 1_000;

export function parseNamespaceSnapshot(value: unknown, request: SessionRequest): NamespaceSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw "invalidResponse";
  const snapshot = value as Record<string, unknown>;
  if (snapshot.clusterId !== request.clusterId || snapshot.sessionId !== request.sessionId
    || !Array.isArray(snapshot.names) || snapshot.names.length > NAMESPACE_LIMIT
    || !snapshot.names.every(name => typeof name === "string" && validNamespace(name))
    || new Set(snapshot.names).size !== snapshot.names.length || typeof snapshot.partial !== "boolean"
    || typeof snapshot.fetchedAt !== "number" || !Number.isSafeInteger(snapshot.fetchedAt) || snapshot.fetchedAt <= 0
    || typeof snapshot.expiresAt !== "number" || !Number.isSafeInteger(snapshot.expiresAt)
    || snapshot.expiresAt <= snapshot.fetchedAt || snapshot.expiresAt - snapshot.fetchedAt > MAX_TTL) throw "invalidResponse";
  return { clusterId: request.clusterId, sessionId: request.sessionId, names: [...snapshot.names].sort((left, right) => left.localeCompare(right)),
    fetchedAt: snapshot.fetchedAt, expiresAt: snapshot.expiresAt, partial: snapshot.partial };
}
function validScope(request: SessionRequest) {
  return [request.clusterId, request.sessionId].every(value => typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f-\u009f]/.test(value));
}
export async function loadNamespaceCache(request: SessionRequest): Promise<NamespaceSnapshot | null> {
  if (!validScope(request)) throw "invalidInput";
  if (!isTauri()) return null;
  let value: unknown;
  try { value = await invoke("cluster_namespace_cache_get", { request }); }
  catch (reason) { throw errorCode(reason); }
  return value === null ? null : parseNamespaceSnapshot(value, request);
}
export async function refreshNamespaceSnapshot(request: NamespaceRefreshRequest): Promise<NamespaceSnapshot> {
  if (!validScope(request) || !Number.isSafeInteger(request.readId) || request.readId <= 0) throw "invalidInput";
  if (!isTauri()) throw "connectionFailed";
  let value: unknown;
  try { value = await invoke("cluster_namespace_cache_refresh", { request }); }
  catch (reason) { throw errorCode(reason); }
  return parseNamespaceSnapshot(value, request);
}
