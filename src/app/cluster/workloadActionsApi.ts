import { invoke, isTauri } from "@tauri-apps/api/core";
import { errorCode, type SessionRequest } from "./api";
import type { ResourceReference } from "./detailApi";

export type WorkloadAction = "scale" | "restart" | "suspend" | "resume" | "trigger";
export type WorkloadActionCancel = SessionRequest & { operationId: number };
export type WorkflowRequest = WorkloadActionCancel & { reference: ResourceReference; resourceVersion: string; action: WorkloadAction; replicas: number | null };
export type WorkloadActionResult = WorkloadActionCancel & { reference: ResourceReference; action: WorkloadAction; accepted: true; created: ResourceReference | null };
const scaleKinds = ["deployments", "statefulSets", "replicaSets", "replicationControllers"];
const restartKinds = ["deployments", "daemonSets", "statefulSets"];
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, fields: string[]) { return Object.keys(value).length === fields.length && fields.every(key => Object.prototype.hasOwnProperty.call(value, key)); }
function identity(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[\x21-\x7e]+$/.test(value); }
function dns(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max && value.split(".").every(part => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)); }
function reference(value: unknown): value is ResourceReference {
  return record(value) && keys(value, ["kind", "namespace", "name", "uid"]) && typeof value.kind === "string"
    && [...scaleKinds, ...restartKinds, "jobs", "cronJobs"].includes(value.kind) && dns(value.name, 253)
    && dns(value.namespace, 63) && !value.namespace.includes(".") && identity(value.uid);
}
function scope(value: Record<string, unknown>) { return identity(value.clusterId) && identity(value.sessionId) && Number.isSafeInteger(value.operationId) && (value.operationId as number) > 0; }
export function parseReplicas(value: string): number | null {
  if (!/^\d{1,10}$/.test(value)) return null;
  const number = Number(value);
  return Number.isInteger(number) && number <= 2147483647 ? number : null;
}
export function validWorkloadRequest(value: unknown): value is WorkflowRequest {
  if (!record(value) || !keys(value, ["clusterId", "sessionId", "operationId", "reference", "resourceVersion", "action", "replicas"])
    || !scope(value) || !reference(value.reference) || !identity(value.resourceVersion)) return false;
  const kind = value.reference.kind;
  switch (value.action) {
    case "scale": return scaleKinds.includes(kind) && typeof value.replicas === "number" && Number.isInteger(value.replicas) && value.replicas >= 0 && value.replicas <= 2147483647;
    case "restart": return restartKinds.includes(kind) && value.replicas === null;
    case "suspend": case "resume": return ["jobs", "cronJobs"].includes(kind) && value.replicas === null;
    case "trigger": return kind === "cronJobs" && value.replicas === null;
    default: return false;
  }
}
export function parseWorkloadActionResult(value: unknown, request: WorkflowRequest): WorkloadActionResult {
  if (!validWorkloadRequest(request) || !record(value) || !keys(value, ["clusterId", "sessionId", "operationId", "reference", "action", "accepted", "created"])
    || value.clusterId !== request.clusterId || value.sessionId !== request.sessionId || value.operationId !== request.operationId
    || value.action !== request.action || value.accepted !== true || !reference(value.reference)
    || (["kind", "namespace", "name", "uid"] as const).some(key => (value.reference as ResourceReference)[key] !== request.reference[key])
    || (request.action === "trigger" ? !reference(value.created) || value.created.kind !== "jobs" || value.created.namespace !== request.reference.namespace : value.created !== null)) throw "invalidResponse";
  return { clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId,
    reference: { ...value.reference }, action: request.action, accepted: true, created: value.created === null ? null : { ...value.created as ResourceReference } };
}
export async function workloadAction(request: WorkflowRequest): Promise<WorkloadActionResult> {
  if (!validWorkloadRequest(request)) throw "invalidInput";
  const snapshot = { ...request, reference: { ...request.reference } };
  if (!isTauri()) throw "connectionFailed";
  let value: unknown;
  try { value = await invoke<unknown>("cluster_workload_action", { request: snapshot }); } catch (reason) { throw errorCode(reason); }
  return parseWorkloadActionResult(value, snapshot);
}
export async function cancelWorkloadAction(request: WorkloadActionCancel): Promise<void> {
  if (!record(request) || !keys(request, ["clusterId", "sessionId", "operationId"]) || !scope(request)) throw "invalidInput";
  if (!isTauri()) return;
  if (await invoke<unknown>("cluster_workload_action_cancel", { request: { ...request } }) !== null) throw "invalidResponse";
}
