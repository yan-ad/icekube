import { invoke, isTauri } from "@tauri-apps/api/core";
import { connectionMessage, errorCode, type ResourceKind, type SessionRequest } from "./api";
import type { ResourceReference } from "./detailApi";
import { resourceViews } from "./resourceViews";

export const collectionKinds = ["pods", "replicaSets", "jobs", "endpointSlices", "events", "resourceQuotas", "limitRanges"] as const;
export type ResourceCollection = typeof collectionKinds[number];
export type CollectionRequest = SessionRequest & { readId: number; reference: ResourceReference; collection: ResourceCollection };
export type CollectionItem = { reference: ResourceReference; status: string; columns: Record<string, string> };
export type ResourceCollectionResponse = CollectionRequest & { state: "complete" | "partial" | "denied" | "unavailable"; items: CollectionItem[] };

const namespaced = new Set<ResourceKind>(["pods", "replicaSets", "jobs", "endpointSlices", "events", "resourceQuotas", "limitRanges"]);
const projectedColumns: Record<ResourceCollection, readonly string[]> = {
  pods: ["ready", "restarts", "node", "qos", "health", "warning", "controlledBy"],
  replicaSets: ["replicas", "desired", "ready", "updated", "available"],
  jobs: ["active", "completions", "failed", "desiredCompletions", "parallelism", "suspend"],
  endpointSlices: ["addressType", "endpoints", "ports", "ready"],
  events: ["type", "reason", "message", "count", "lastSeen", "occurrenceTime", "source", "involvedObject"],
  resourceQuotas: ["cpuUsed", "cpuHard", "memoryUsed", "memoryHard", "podsUsed", "podsHard", "cpuLimitUsed", "cpuLimitHard", "memoryLimitUsed", "memoryLimitHard", "scopes"],
  limitRanges: ["types", "minCpu", "maxCpu"],
};
const allowed: Record<ResourceKind, readonly ResourceCollection[]> = {
  nodes: ["pods", "events"], namespaces: ["resourceQuotas", "limitRanges", "events"],
  deployments: ["pods", "replicaSets", "events"], daemonSets: ["pods", "events"], statefulSets: ["pods", "events"],
  replicaSets: ["pods", "events"], replicationControllers: ["pods", "events"], jobs: ["pods", "events"], cronJobs: ["jobs", "events"],
  services: ["endpointSlices", "events"], resourceQuotas: ["events"], limitRanges: ["events"],
  pods: ["events"], endpointSlices: ["events"], events: ["events"],
  configMaps: [], secrets: [], horizontalPodAutoscalers: ["events"], verticalPodAutoscalers: ["events"], podDisruptionBudgets: ["events"],
  priorityClasses: ["events"], runtimeClasses: ["events"], leases: ["events"], endpoints: ["events"], ingresses: ["events"], ingressClasses: ["events"],
  networkPolicies: ["events"], mutatingWebhookConfigurations: ["events"], validatingWebhookConfigurations: ["events"], validatingAdmissionPolicies: ["events"],
  validatingAdmissionPolicyBindings: ["events"], podSecurityPolicies: ["events"], persistentVolumes: ["events"], persistentVolumeClaims: ["events"],
  storageClasses: ["events"], serviceAccounts: ["events"], roles: ["events"], roleBindings: ["events"], clusterRoles: ["events"], clusterRoleBindings: ["events"],
  customResourceDefinitions: ["events"],
};

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function closed(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).every(key => keys.includes(key)); }
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }
function id(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[^\x21-\x7e]/.test(value); }
function namespace(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value); }
function name(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 253 && value !== "." && value !== ".." && /^[A-Za-z0-9_.:-]+$/.test(value); }
function reference(value: unknown, expected?: ResourceCollection): value is ResourceReference {
  if (!record(value) || !closed(value, ["kind", "namespace", "name", "uid"]) || typeof value.kind !== "string" || !name(value.name) || typeof value.uid !== "string" || !id(value.uid)) return false;
  const kind = value.kind as ResourceKind;
  if (expected === "pods" && kind !== "pods" || expected === "replicaSets" && kind !== "replicaSets" || expected === "jobs" && kind !== "jobs"
    || expected === "endpointSlices" && kind !== "endpointSlices" || expected === "events" && kind !== "events"
    || expected === "resourceQuotas" && kind !== "resourceQuotas" || expected === "limitRanges" && kind !== "limitRanges") return false;
  if (!Object.prototype.hasOwnProperty.call(allowed, kind)) return false;
  const scoped = namespaced.has(kind) || resourceViews.find(view => view.kind === kind)?.namespaced === true;
  return scoped ? namespace(value.namespace) : value.namespace === null;
}
function validRequest(value: unknown): value is CollectionRequest {
  if (!record(value) || !closed(value, ["clusterId", "sessionId", "readId", "reference", "collection"]) || !text(value.clusterId, 256) || !text(value.sessionId, 256)
    || value.clusterId.trim() !== value.clusterId || value.sessionId.trim() !== value.sessionId
    || typeof value.readId !== "number" || !Number.isSafeInteger(value.readId) || value.readId <= 0 || !collectionKinds.includes(value.collection as ResourceCollection) || !reference(value.reference)) return false;
  return (allowed[value.reference.kind as ResourceKind] ?? []).includes(value.collection as ResourceCollection);
}
export function collectionsFor(kind: ResourceKind): readonly ResourceCollection[] { return allowed[kind] ?? []; }
export function parseResourceCollection(value: unknown, request: CollectionRequest): ResourceCollectionResponse {
  if (!validRequest(request) || !record(value) || !closed(value, ["clusterId", "sessionId", "readId", "reference", "collection", "state", "items"])
    || value.clusterId !== request.clusterId || value.sessionId !== request.sessionId || value.readId !== request.readId || value.collection !== request.collection
    || !reference(value.reference) || value.reference.kind !== request.reference.kind || value.reference.name !== request.reference.name || value.reference.namespace !== request.reference.namespace
    || value.reference.uid !== request.reference.uid || !["complete", "partial", "denied", "unavailable"].includes(value.state as string)
    || !Array.isArray(value.items) || value.items.length > 100 || new TextEncoder().encode(JSON.stringify(value)).length > 64 * 1024) throw "invalidResponse";
  if ((value.state === "denied" || value.state === "unavailable") && value.items.length !== 0) throw "invalidResponse";
  const items = value.items.map(item => {
    if (!record(item) || !closed(item, ["reference", "status", "columns"]) || !reference(item.reference, request.collection)
      || !text(item.status, 256) || !record(item.columns) || Object.keys(item.columns).length > 12
      || !Object.entries(item.columns).every(([key, column]) => text(key, 128) && typeof column === "string" && column.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(column))) throw "invalidResponse";
    const ref = item.reference as ResourceReference;
    const expectedNamespace = request.reference.kind === "namespaces" ? request.reference.name : request.reference.namespace;
    if (expectedNamespace !== null && ref.namespace !== expectedNamespace) throw "invalidResponse";
    if (!Object.keys(item.columns).every(key => projectedColumns[request.collection].includes(key))) throw "invalidResponse";
    return { reference: { kind: ref.kind, namespace: ref.namespace, name: ref.name, uid: ref.uid }, status: item.status, columns: { ...item.columns } as Record<string, string> };
  });
  return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, reference: { ...value.reference } as ResourceReference, collection: request.collection, state: value.state as ResourceCollectionResponse["state"], items };
}
async function command(commandName: string, request: CollectionRequest): Promise<unknown> {
  if (!validRequest(request)) throw "invalidInput";
  if (!isTauri()) throw "connectionFailed";
  try { return await invoke<unknown>(commandName, { request }); } catch (reason) { throw errorCode(reason); }
}
export async function loadResourceCollection(request: CollectionRequest): Promise<ResourceCollectionResponse> {
  const snapshot = { ...request, reference: { ...request.reference } };
  return parseResourceCollection(await command("cluster_resource_collection", snapshot), snapshot);
}
export async function cancelResourceCollection(request: CollectionRequest): Promise<void> {
  const result = await command("cluster_resource_collection_cancel", request);
  if (result !== null && result !== undefined) throw "invalidResponse";
}
export function collectionErrorMessage(reason: unknown): string {
  return connectionMessage(errorCode(reason));
}
