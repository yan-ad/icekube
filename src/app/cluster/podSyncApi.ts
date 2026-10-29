import { invoke, hasEngine as isTauri } from "../engine";
import { errorCode, validResourceIdentity, type ConnectionErrorCode, type ResourcePage, type ResourceRequest } from "./api";

export type PodSyncStatus = "opening" | "syncing" | "retrying" | "error" | "stopped";
export type PodSyncSnapshot = {
  clusterId: string;
  sessionId: string;
  syncId: string;
  sequence: number;
  page: ResourcePage | null;
  status: PodSyncStatus;
  error: ConnectionErrorCode | null;
};

type PodSyncRequest = ResourceRequest & { continueToken: null };
const syncStatuses = new Set<PodSyncStatus>(["opening", "syncing", "retrying", "error", "stopped"]);
const safeText = (value: unknown, max = 4096): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const namespace = (value: unknown): value is string => typeof value === "string" && value.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value);
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

async function command(name: string, request: object): Promise<unknown> {
  if (!isTauri()) throw "connectionFailed";
  try { return await invoke<unknown>(name, { request }); } catch (reason) { throw errorCode(reason); }
}

function parsePage(value: unknown, request: PodSyncRequest): ResourcePage | null {
  if (value === null) return null;
  if (!record(value) || value.clusterId !== request.clusterId || value.sessionId !== request.sessionId || value.kind !== "pods"
    || !nonnegative(value.readId) || value.readId === 0 || !Array.isArray(value.items) || value.items.length > 100
    || value.continueToken !== null || value.readId !== request.readId || !nonnegative(value.fetchedAt) || value.fetchedAt > 8.64e15
    || typeof value.truncated !== "boolean" || value.namespace !== (request.namespace ?? null)
    || (value.namespace !== null && !namespace(value.namespace)) || value.metrics !== null) throw "invalidResponse";
  const items = value.items.map((item): ResourcePage["items"][number] => {
    if (!record(item) || !safeText(item.name, 253) || !safeText(item.status, 256)
      || !validResourceIdentity(item.uid) || !validResourceIdentity(item.resourceVersion)
      || !namespace(item.namespace) || (request.namespace != null && item.namespace !== request.namespace)
      || (item.createdAt !== null && (!safeText(item.createdAt, 64) || !Number.isFinite(Date.parse(item.createdAt)))) || !record(item.columns)
      || Object.keys(item.columns).length > 12 || !Object.entries(item.columns).every(([key, column]) => safeText(key, 128) && typeof column === "string" && column.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(column))
      || item.node !== null) throw "invalidResponse";
    return { name: item.name, status: item.status, namespace: item.namespace as string | null,
      uid: typeof item.uid === "string" ? item.uid : null, resourceVersion: typeof item.resourceVersion === "string" ? item.resourceVersion : null,
      createdAt: item.createdAt as string | null, columns: Object.fromEntries(Object.entries(item.columns).filter(([, column]) => typeof column === "string")) as Record<string, string>, node: null };
  });
  if (new Set(items.map((item) => `${item.namespace ?? ""}\u0000${item.name}`)).size !== items.length) throw "invalidResponse";
  return { clusterId: request.clusterId, sessionId: request.sessionId, kind: "pods", readId: value.readId as number, items,
    truncated: value.truncated as boolean, fetchedAt: value.fetchedAt as number, namespace: value.namespace as string | null,
    continueToken: value.continueToken as string | null, metrics: null };
}

function parseSnapshot(value: unknown, request: { clusterId: string; sessionId: string; syncId?: string }, podRequest: PodSyncRequest): PodSyncSnapshot {
  if (!record(value) || value.clusterId !== request.clusterId || value.sessionId !== request.sessionId || !safeText(value.syncId, 256)
    || (request.syncId !== undefined && value.syncId !== request.syncId) || !nonnegative(value.sequence)
    || typeof value.status !== "string" || !syncStatuses.has(value.status as PodSyncStatus)
    || (value.error !== null && (!safeText(value.error, 64) || errorCode(value.error) !== value.error))
    || (value.status === "error" && value.error === null)) throw "invalidResponse";
  return { clusterId: value.clusterId, sessionId: value.sessionId, syncId: value.syncId, sequence: value.sequence,
    page: parsePage(value.page, podRequest), status: value.status as PodSyncStatus,
    error: value.error === null ? null : errorCode(value.error) };
}

export async function openPodSync(request: PodSyncRequest): Promise<PodSyncSnapshot> {
  if (request.kind !== "pods" || request.continueToken !== null || !safeText(request.clusterId) || !safeText(request.sessionId)
    || !nonnegative(request.readId) || request.readId === 0 || (request.namespace != null && !namespace(request.namespace))) throw "invalidInput";
  const value = await command("cluster_pod_sync_open", request);
  try { return parseSnapshot(value, request, request); }
  catch (reason) {
    if (record(value) && value.clusterId === request.clusterId && value.sessionId === request.sessionId && safeText(value.syncId, 256)) {
      void closePodSync({ clusterId: request.clusterId, sessionId: request.sessionId, syncId: value.syncId }).catch(() => {});
    }
    throw reason;
  }
}
export async function readPodSync(request: { clusterId: string; sessionId: string; syncId: string; readId: number }, podRequest: PodSyncRequest): Promise<PodSyncSnapshot> {
  if (!safeText(request.syncId, 256) || !Number.isSafeInteger(request.readId) || request.readId <= 0) throw "invalidInput";
  return parseSnapshot(await command("cluster_pod_sync_read", { clusterId: request.clusterId, sessionId: request.sessionId, syncId: request.syncId }), request, podRequest);
}
export async function closePodSync(request: { clusterId: string; sessionId: string; syncId: string }): Promise<void> {
  if (!safeText(request.syncId, 256)) throw "invalidInput";
  const result = await command("cluster_pod_sync_close", request);
  if (result !== undefined && result !== null) throw "invalidResponse";
}
