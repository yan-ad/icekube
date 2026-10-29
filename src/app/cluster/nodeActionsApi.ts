import { invoke, isTauri } from "@tauri-apps/api/core";
import { errorCode, type SessionRequest } from "./api";
import type { ResourceReference } from "./detailApi";

export type NodeAction = "cordon" | "uncordon";
export type NodeActionCancel = SessionRequest & { operationId: number };
export type NodeActionRequest = NodeActionCancel & { reference: ResourceReference; resourceVersion: string; action: NodeAction };
export type NodeActionResult = NodeActionCancel & { reference: ResourceReference; action: NodeAction; accepted: boolean };
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, fields: string[]) { return Object.keys(value).length === fields.length && fields.every(key => Object.prototype.hasOwnProperty.call(value, key)); }
function identity(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[\x21-\x7e]+$/.test(value); }
function reference(value: unknown): value is ResourceReference {
  return record(value) && keys(value, ["kind", "namespace", "name", "uid"]) && value.kind === "nodes" && value.namespace === null
    && typeof value.name === "string" && value.name.length <= 253 && value.name.split(".").every(part => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)) && identity(value.uid);
}
function scope(value: Record<string, unknown>) { return identity(value.clusterId) && identity(value.sessionId) && Number.isSafeInteger(value.operationId) && (value.operationId as number) > 0; }
export function validNodeActionRequest(value: unknown): value is NodeActionRequest {
  return record(value) && keys(value, ["clusterId", "sessionId", "operationId", "reference", "resourceVersion", "action"])
    && scope(value) && reference(value.reference) && identity(value.resourceVersion) && (value.action === "cordon" || value.action === "uncordon");
}
export function parseNodeActionResult(value: unknown, request: NodeActionRequest): NodeActionResult {
  if (!validNodeActionRequest(request) || !record(value) || !keys(value, ["clusterId", "sessionId", "operationId", "reference", "action", "accepted"])
    || value.clusterId !== request.clusterId || value.sessionId !== request.sessionId || value.operationId !== request.operationId
    || value.action !== request.action || typeof value.accepted !== "boolean" || !reference(value.reference)
    || (["kind", "namespace", "name", "uid"] as const).some(key => (value.reference as ResourceReference)[key] !== request.reference[key])) throw "invalidResponse";
  return { clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId,
    reference: { ...value.reference }, action: request.action, accepted: value.accepted };
}
export async function nodeAction(request: NodeActionRequest): Promise<NodeActionResult> {
  if (!validNodeActionRequest(request)) throw "invalidInput";
  const snapshot = { ...request, reference: { ...request.reference } };
  if (!isTauri()) throw "connectionFailed";
  let value: unknown;
  try { value = await invoke<unknown>("cluster_node_action", { request: snapshot }); } catch (reason) { throw errorCode(reason); }
  return parseNodeActionResult(value, snapshot);
}
export async function cancelNodeAction(request: NodeActionCancel): Promise<void> {
  if (!record(request) || !keys(request, ["clusterId", "sessionId", "operationId"]) || !scope(request)) throw "invalidInput";
  if (!isTauri()) return;
  if (await invoke<unknown>("cluster_node_action_cancel", { request: { ...request } }) !== null) throw "invalidResponse";
}
