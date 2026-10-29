import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ResourceKind, SessionRequest } from "./api";
import type { ResourceReference } from "./detailApi";

export type EditMode = "read" | "dryRun" | "apply";
export type EditCancelRequest = SessionRequest & { operationId: number };
export type EditRequest = EditCancelRequest & { reference: ResourceReference; resourceVersion?: string; yaml?: string; mode: EditMode };
export type EditResult = EditCancelRequest & { reference: ResourceReference; resourceVersion: string; yaml: string | null; mode: EditMode; accepted: boolean };
const reviewedKinds: ResourceKind[] = ["deployments", "daemonSets", "statefulSets", "replicaSets", "replicationControllers", "jobs", "cronJobs", "horizontalPodAutoscalers", "podDisruptionBudgets", "nodes", "persistentVolumes", "persistentVolumeClaims", "services", "storageClasses"];
export function resourceEditable(kind: ResourceKind) { return reviewedKinds.includes(kind); }
const safe = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
const bounded = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && !value.includes("\0") && new TextEncoder().encode(value).length <= 64 * 1024;
function validCancel(request: EditCancelRequest) { return safe(request.clusterId) && safe(request.sessionId) && Number.isSafeInteger(request.operationId) && request.operationId > 0; }
export async function editResource(request: EditRequest): Promise<EditResult> {
  if (!validCancel(request) || !resourceEditable(request.reference.kind) || !safe(request.reference.name) || !safe(request.reference.uid)
    || !["read", "dryRun", "apply"].includes(request.mode)
    || (request.mode === "read" ? request.yaml !== undefined || request.resourceVersion !== undefined : !safe(request.resourceVersion) || !bounded(request.yaml))) throw "invalidInput";
  if (!isTauri()) throw "connectionFailed";
  const value = await invoke<unknown>("cluster_resource_edit", { request });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw "invalidResponse";
  const result = value as EditResult;
  if (result.clusterId !== request.clusterId || result.sessionId !== request.sessionId || result.operationId !== request.operationId
    || result.mode !== request.mode || result.accepted !== (request.mode !== "read") || !safe(result.resourceVersion)
    || !result.reference || result.reference.kind !== request.reference.kind || result.reference.namespace !== request.reference.namespace
    || result.reference.name !== request.reference.name || result.reference.uid !== request.reference.uid
    || (request.mode === "read" ? !bounded(result.yaml) : result.yaml !== null)) throw "invalidResponse";
  return result;
}
export async function cancelResourceEdit(request: EditCancelRequest): Promise<void> {
  if (!validCancel(request)) throw "invalidInput";
  if (isTauri()) await invoke("cluster_resource_edit_cancel", { request: { clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId } });
}
