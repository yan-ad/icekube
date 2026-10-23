import { invoke, isTauri } from "@tauri-apps/api/core";

const messages = {
  invalidInput: "The cluster request is invalid. Return to Catalog and choose the saved context again.",
  notFound: "This saved cluster no longer exists. Refresh Catalog and choose a cluster again.",
  kubeconfigUnavailable: "The saved kubeconfig cannot be read. Check the file and its symbolic-link target.",
  kubeconfigInvalid: "The saved kubeconfig or selected context is invalid. Import the corrected file in Catalog.",
  sourceChanged: "The saved kubeconfig has changed. Refresh the saved metadata before connecting again.",
  unsupportedAuth: "This context uses an authentication method that is not supported yet.",
  insecureTransport: "This context uses an insecure transport configuration. Check its TLS settings.",
  authFailed: "Cluster authentication failed. Check the selected context's credentials.",
  tlsFailed: "The cluster TLS connection could not be verified. Check the cluster certificate settings.",
  permissionDenied: "The cluster rejected this request. Check the identity's Kubernetes permissions.",
  timeout: "The cluster did not respond before the request timed out. Try again.",
  network: "The cluster could not be reached. Check the network or proxy settings.",
  connectionFailed: "The cluster operation failed. No connection or resource result has been assumed.",
  notConnected: "Connect to this cluster before loading live resources.",
  staleSession: "This cluster session is stale. Disconnect and connect again.",
  busy: "The cluster engine is busy. Try again shortly.",
  limitExceeded: "The cluster response exceeds the supported size limit.",
  invalidResponse: "The cluster engine returned an unsupported response. Disconnect and try again.",
  storeUnavailable: "Saved cluster metadata could not be read. Check access to the app's data directory.",
} as const;
export type ConnectionErrorCode = keyof typeof messages;
export type SessionRequest = { clusterId: string; sessionId: string };
export type ConnectionSnapshot = SessionRequest & {
  contextName: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  apiVersion: string | null;
  error: ConnectionErrorCode | null;
};
export type ResourceKind = "nodes" | "namespaces";
export type ResourceRequest = SessionRequest & { kind: ResourceKind; readId: number };
export type ResourceItem = { name: string; status: string };
export type ResourcePage = ResourceRequest & {
  kind: ResourceKind; items: ResourceItem[]; truncated: boolean; fetchedAt: number;
};
let lastReadId = 0;
export function nextReadId(): number {
  if (lastReadId === Number.MAX_SAFE_INTEGER) throw "limitExceeded";
  return ++lastReadId;
}
function validReadId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function errorCode(value: unknown): ConnectionErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(messages, value) ? value as ConnectionErrorCode : "connectionFailed";
}
export function connectionMessage(code: ConnectionErrorCode) { return messages[code]; }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function identity(value: Record<string, unknown>, request: { clusterId: string; sessionId?: string }) {
  return text(value.clusterId) && value.clusterId === request.clusterId && text(value.sessionId)
    && (request.sessionId === undefined || value.sessionId === request.sessionId);
}
function parseConnection(value: unknown, request: { clusterId: string; sessionId?: string }): ConnectionSnapshot {
  if (!record(value) || !identity(value, request) || !text(value.contextName)
    || !["disconnected", "connecting", "connected", "error"].includes(value.status as string)
    || !(value.apiVersion === null || text(value.apiVersion, 256))
    || !(value.error === null || typeof value.error === "string" && Object.prototype.hasOwnProperty.call(messages, value.error))
    || (value.status === "connected" && (value.apiVersion === null || value.error !== null))
    || (value.status === "error" && value.error === null)) throw "invalidResponse";
  return { clusterId: value.clusterId as string, sessionId: value.sessionId as string,
    contextName: value.contextName, status: value.status as ConnectionSnapshot["status"],
    apiVersion: value.apiVersion as string | null, error: value.error as ConnectionErrorCode | null };
}
async function command(name: string, request: object): Promise<unknown> {
  if (!isTauri()) throw "connectionFailed";
  try { return await invoke<unknown>(name, { request }); }
  catch (reason) { throw errorCode(reason); }
}
export async function openSession(clusterId: string) {
  const request = { clusterId };
  const value = await command("cluster_session_open", request);
  try {
    const snapshot = parseConnection(value, request);
    if (snapshot.status !== "disconnected") throw "invalidResponse";
    return snapshot;
  } catch (reason) {
    // Release a recognizable lease even when the remainder of its response is invalid.
    if (record(value) && identity(value, request)) {
      void disconnectSession({ clusterId, sessionId: value.sessionId as string }).catch(() => {});
    }
    throw reason;
  }
}
export async function connectSession(request: SessionRequest) {
  return parseConnection(await command("cluster_connect", request), request);
}
export async function disconnectSession(request: SessionRequest) {
  const result = await command("cluster_disconnect", request);
  if (result !== undefined && result !== null) throw "invalidResponse";
}
export async function cancelResources(request: ResourceRequest): Promise<void> {
  if (!validReadId(request.readId)) throw "invalidInput";
  const result = await command("cluster_resources_cancel", request);
  if (result !== undefined && result !== null) throw "invalidResponse";
}
export async function loadResources(request: ResourceRequest): Promise<ResourcePage> {
  if (!validReadId(request.readId)) throw "invalidInput";
  const value = await command("cluster_resources", request);
  if (!record(value) || !identity(value, request) || value.kind !== request.kind
    || !validReadId(value.readId) || value.readId !== request.readId
    || !Array.isArray(value.items) || value.items.length > 100
    || !value.items.every((item) => record(item) && text(item.name, 253) && text(item.status, 256))
    || new Set(value.items.map((item) => item.name)).size !== value.items.length
    || typeof value.truncated !== "boolean" || !Number.isSafeInteger(value.fetchedAt) || (value.fetchedAt as number) < 0
    || (value.fetchedAt as number) > 8.64e15) throw "invalidResponse";
  return { clusterId: request.clusterId, sessionId: request.sessionId, kind: request.kind, readId: value.readId,
    items: value.items.map((item) => ({ name: item.name as string, status: item.status as string })),
    truncated: value.truncated, fetchedAt: value.fetchedAt as number };
}
