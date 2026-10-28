import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MetricState, NodeInfo } from "./nodeContract";
import { metricStates, parseNode, validTimestamp } from "./nodeContract";
import { resourceViews, type TableResourceKind } from "./resourceViews";

const messages = {
  conflict: "The resource changed. Reload its details before trying again.",
  processUnavailable: "The container process is unavailable. Choose a running container or another shell.",
  helmUnavailable: "Helm is not installed or executable on the desktop app's PATH.",
  invalidInput: "The cluster request is invalid. Return to Catalog and choose the saved context again.",
  notFound: "This saved cluster no longer exists. Refresh Catalog and choose a cluster again.",
  kubeconfigUnavailable: "The saved kubeconfig cannot be read. Check the file and its symbolic-link target.",
  kubeconfigInvalid: "The saved kubeconfig or selected context is invalid. Import the corrected file in Catalog.",
  sourceChanged: "The saved kubeconfig has changed. Refresh the saved metadata before connecting again.",
  unsupportedAuth: "This context uses an authentication method that is not supported yet.",
  authHelperMissing: "The configured authentication helper was not found after automatic lookup. Check that the required cloud authentication plugin is installed. Iceon detects standard and literal SDK installation paths without changing your kubeconfig; an explicit command or PATH in that file is respected.",
  authHelperFailed: "The authentication helper failed. Complete its login using your trusted CLI, then reconnect. Helper output is not displayed because it may contain credentials.",
  authHelperInvalidResponse: "The authentication helper returned invalid credentials. Check that it supports the kubeconfig's ExecCredential API version, then reconnect.",
  authInteractiveRequired: "This authentication helper requires interactive input. Complete login in your trusted CLI and use a non-interactive credential helper before reconnecting.",
  authExpired: "Fresh authentication credentials could not be obtained. Configured exec helpers and rotating token files renew automatically; static or legacy credentials may require login using your trusted CLI, then reconnect.",
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
  resourceUnavailable: "This cluster resource is unavailable. Try again after reconnecting.",
} as const;
export type ConnectionErrorCode = keyof typeof messages;
export type SessionRequest = { clusterId: string; sessionId: string };
export type ConnectionSnapshot = SessionRequest & {
  contextName: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  apiVersion: string | null;
  error: ConnectionErrorCode | null;
};
export type ResourceKind = "nodes" | TableResourceKind;
export type ResourceRequest = SessionRequest & {
  kind: ResourceKind;
  readId: number;
  namespace?: string | null;
  continueToken?: string | null;
  query?: string | null;
  status?: string | null;
  group?: string | null;
};
export type ResourceItem = {
  name: string;
  uid?: string | null;
  resourceVersion?: string | null;
  status: string;
  namespace: string | null;
  createdAt: string | null;
  columns: Record<string, string>;
  node: NodeInfo | null;
};
export type ResourcePage = ResourceRequest & {
  kind: ResourceKind;
  items: ResourceItem[];
  truncated: boolean;
  fetchedAt: number;
  namespace: string | null;
  continueToken: string | null;
  metrics: MetricState | null;
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
function safeText(value: unknown, max = 4096): value is string {
  return text(value, max) && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
export function validResourceIdentity(value: unknown): value is string | null | undefined {
  return value === undefined || value === null
    || typeof value === "string" && value.length > 0 && value.length <= 256 && !/[^\x21-\x7e]/.test(value);
}
function validNamespace(value: unknown): value is string {
  return typeof value === "string" && value.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}
function validContinueToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
const tableKinds = new Set<TableResourceKind>(resourceViews.flatMap((view) => view.kind ? [view.kind] : []));
function knownResourceKind(value: unknown): value is ResourceKind {
  return value === "nodes" || typeof value === "string" && tableKinds.has(value as TableResourceKind);
}
function isNamespacedKind(kind: ResourceKind): boolean {
  return kind !== "nodes" && resourceViews.find((view) => view.kind === kind)?.namespaced === true;
}
function validResourceRequest(request: ResourceRequest): boolean {
  return knownResourceKind(request.kind) && validReadId(request.readId)
    && (request.namespace == null || isNamespacedKind(request.kind))
    && (request.namespace === undefined || request.namespace === null || validNamespace(request.namespace))
    && (request.continueToken === undefined || request.continueToken === null || validContinueToken(request.continueToken))
    && [request.query, request.status, request.group].every((value) => value === undefined || value === null
      || typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(value))
    && (request.group == null || request.kind === "customResourceDefinitions");
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
let pendingOpen: Promise<unknown> = Promise.resolve();
export function openSession(clusterId: string): Promise<ConnectionSnapshot> {
  // Rust has one workspace lease; keep IPC arrival order aligned with view ownership.
  const next = pendingOpen.then(() => openSessionOrdered(clusterId));
  pendingOpen = next.catch(() => {});
  return next;
}
async function openSessionOrdered(clusterId: string) {
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
  if (!validResourceRequest(request)) throw "invalidInput";
  const result = await command("cluster_resources_cancel", request);
  if (result !== undefined && result !== null) throw "invalidResponse";
}
export async function loadResources(request: ResourceRequest): Promise<ResourcePage> {
  request = { ...request };
  if (!validResourceRequest(request)) throw "invalidInput";
  const value = await command("cluster_resources", request);
  const responseNamespace = record(value) ? value.namespace : undefined;
  const requestedNamespace = request.namespace ?? null;
  const legacyKind = request.kind === "nodes" || request.kind === "namespaces";
  const legacyMissingNamespace = legacyKind && requestedNamespace === null && responseNamespace === undefined;
  if (!record(value) || !identity(value, request) || value.kind !== request.kind
    || !validReadId(value.readId) || value.readId !== request.readId
    || (!legacyMissingNamespace && !(responseNamespace === null || validNamespace(responseNamespace)))
    || (!legacyMissingNamespace && responseNamespace !== requestedNamespace)
    || !Array.isArray(value.items) || value.items.length > 100
    || !value.items.every((item) => {
      if (!record(item) || !safeText(item.name, 253) || !safeText(item.status, 256)) return false;
      if (!validResourceIdentity(item.uid) || !validResourceIdentity(item.resourceVersion)) return false;
      const itemNamespace = item.namespace;
      if (!legacyKind && itemNamespace === undefined) return false;
      if (itemNamespace !== undefined && itemNamespace !== null
        && !validNamespace(itemNamespace)) return false;
      if (isNamespacedKind(request.kind) && !validNamespace(itemNamespace)) return false;
      if (!isNamespacedKind(request.kind) && itemNamespace != null) return false;
      if (requestedNamespace !== null && itemNamespace !== requestedNamespace) return false;
      if (item.createdAt !== undefined && item.createdAt !== null && !validTimestamp(item.createdAt)) return false;
      if (item.columns !== undefined) {
        if (!record(item.columns) || Object.keys(item.columns).length > 12
          || !Object.entries(item.columns).every(([key, column]) => safeText(key, 128)
            && typeof column === "string" && column.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(column))) return false;
      } else if (!legacyKind) return false;
      return true;
    })
    || new Set(value.items.map((item) => `${item.namespace ?? ""}\u0000${item.name}`)).size !== value.items.length
    || typeof value.truncated !== "boolean" || !Number.isSafeInteger(value.fetchedAt) || (value.fetchedAt as number) < 0
    || (value.fetchedAt as number) > 8.64e15
    || (value.continueToken !== undefined && value.continueToken !== null && !validContinueToken(value.continueToken))) throw "invalidResponse";
  const metrics = value.metrics === null || value.metrics === undefined ? null
    : typeof value.metrics === "string" && metricStates.includes(value.metrics as MetricState)
      ? value.metrics as MetricState : null;
  if (value.metrics !== null && value.metrics !== undefined && metrics === null) throw "invalidResponse";
  const items = value.items.map((item) => ({
    name: item.name as string,
    uid: typeof item.uid === "string" ? item.uid : null,
    resourceVersion: typeof item.resourceVersion === "string" ? item.resourceVersion : null,
    status: item.status as string,
    namespace: typeof item.namespace === "string" ? item.namespace : null,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
    columns: item.columns === undefined ? {} : Object.fromEntries(Object.entries(item.columns)) as Record<string, string>,
    node: request.kind === "nodes" ? parseNode(item.node) : null,
  }));
  return { clusterId: request.clusterId, sessionId: request.sessionId, kind: request.kind, readId: value.readId,
    items, truncated: value.truncated, fetchedAt: value.fetchedAt as number,
    namespace: responseNamespace === undefined ? null : responseNamespace as string | null,
    continueToken: value.continueToken === undefined || value.continueToken === null ? null : value.continueToken as string, metrics };
}
