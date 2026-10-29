import { invoke, hasEngine as isTauri } from "../engine";
import { nextReadId, type ResourceKind, type SessionRequest } from "./api";
import { resourceViews } from "./resourceViews";

export const permissionActions = ["list", "get", "create", "update", "patch", "delete", "watch", "logs", "exec", "attach", "portForward"] as const;
export type PermissionAction = typeof permissionActions[number];
export type PermissionDecision = "allowed" | "denied" | "unknown";
export type PermissionCheck = { kind: ResourceKind; action: PermissionAction; namespace: string | null; name: string | null };
export type PermissionCheckInput = Omit<PermissionCheck, "namespace" | "name"> & { namespace?: string | null; name?: string | null };
export type PermissionReviewRequest = SessionRequest & { readId: number; checks: PermissionCheck[] };
export type PermissionReview = SessionRequest & { readId: number; authorizationEpoch: string; revision: number; checkedAt: number; expiresAt: number; items: { check: PermissionCheck; decision: PermissionDecision; reason: null | "reviewDenied" | "reviewUnavailable" | "reviewFailed" }[] };
const kinds = new Set<string>(["nodes", ...resourceViews.flatMap(view => view.kind ? [view.kind] : [])]);
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: string[]) { return Object.keys(value).length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(value, key)); }
function safeText(value: unknown, max: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= max && !/[\s\u0000-\u001f\u007f-\u009f]/.test(value); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function validSession(value: unknown): value is SessionRequest { return record(value) && safeText(value.clusterId, 256) && safeText(value.sessionId, 256); }
export function permissionCheck(input: PermissionCheckInput): PermissionCheck {
  const namespaced = resourceViews.some(view => view.kind === input.kind && view.namespaced);
  return { kind: input.kind, action: input.action, namespace: namespaced ? input.namespace ?? null : null, name: input.name ?? null };
}
export function permissionKey(input: PermissionCheckInput): string {
  const check = permissionCheck(input);
  return JSON.stringify([check.kind, check.action, check.namespace, check.name]);
}
export function validPermissionCheck(value: unknown): value is PermissionCheck {
  if (!record(value) || !keys(value, ["kind", "action", "namespace", "name"]) || typeof value.kind !== "string" || !kinds.has(value.kind)
    || !permissionActions.includes(value.action as PermissionAction)
    || !(value.namespace === null || typeof value.namespace === "string" && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value.namespace))) return false;
  const rbac = ["roles", "clusterRoles", "roleBindings", "clusterRoleBindings"].includes(value.kind);
  if (value.name !== null && !(safeText(value.name, 253) && (rbac ? /^[a-zA-Z0-9_.:-]+$/ : /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/).test(value.name) && value.name !== "." && value.name !== "..")) return false;
  const check = value as PermissionCheck;
  const scoped = resourceViews.some(view => view.kind === check.kind && view.namespaced);
  return permissionCheck(check).namespace === check.namespace
    && (!scoped || check.namespace !== null || check.action === "list" || check.action === "watch")
    && (!(check.action === "list" || check.action === "watch") || check.name === null)
    && (!["logs", "exec", "attach", "portForward"].includes(check.action) || check.kind === "pods" && check.name !== null);
}
function validRequest(request: PermissionReviewRequest) {
  return validSession(request) && keys(request, ["clusterId", "sessionId", "readId", "checks"])
    && integer(request.readId) && request.readId > 0 && Array.isArray(request.checks) && request.checks.length > 0 && request.checks.length <= 32
    && request.checks.every(validPermissionCheck) && new Set(request.checks.map(permissionKey)).size === request.checks.length;
}
export function parsePermissionReview(value: unknown, request: PermissionReviewRequest, now = Date.now()): PermissionReview {
  if (!validRequest(request) || !integer(now) || !record(value) || !keys(value, ["clusterId", "sessionId", "readId", "authorizationEpoch", "revision", "checkedAt", "expiresAt", "items"])
    || value.clusterId !== request.clusterId || value.sessionId !== request.sessionId || value.readId !== request.readId
    || !safeText(value.authorizationEpoch, 256) || !integer(value.revision)
    || !integer(value.checkedAt) || !integer(value.expiresAt) || value.checkedAt > now + 30_000
    || value.expiresAt <= now || value.expiresAt <= value.checkedAt || value.expiresAt > value.checkedAt + 300_000
    || !Array.isArray(value.items) || value.items.length !== request.checks.length) throw "invalidResponse";
  const remaining = new Set(request.checks.map(permissionKey));
  for (const item of value.items) {
    if (!record(item) || !keys(item, ["check", "decision", "reason"]) || !validPermissionCheck(item.check) || !remaining.delete(permissionKey(item.check))
      || !["allowed", "denied", "unknown"].includes(item.decision as string)
      || !(item.reason === null || ["reviewDenied", "reviewUnavailable", "reviewFailed"].includes(item.reason as string))
      || (item.decision === "allowed" && item.reason !== null)) throw "invalidResponse";
  }
  return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
    authorizationEpoch: value.authorizationEpoch, revision: value.revision, checkedAt: value.checkedAt, expiresAt: value.expiresAt,
    items: value.items.map(item => ({ check: permissionCheck(item.check), decision: item.decision, reason: item.reason })) };
}
export async function reviewPermissions(request: PermissionReviewRequest): Promise<PermissionReview> {
  if (!isTauri() || !validRequest(request)) throw "invalidInput";
  return parsePermissionReview(await invoke<unknown>("cluster_permissions_review", { request }), request);
}
export async function refreshPermissions(request: SessionRequest): Promise<void> {
  if (!isTauri() || !validSession(request) || !keys(request, ["clusterId", "sessionId"])) throw "invalidInput";
  if (await invoke<unknown>("cluster_permissions_refresh", { request }) !== null) throw "invalidResponse";
}
export async function cancelPermissionReview(request: PermissionReviewRequest): Promise<void> {
  if (isTauri() && validRequest(request)) await invoke("cluster_permissions_cancel", { request });
}
export { nextReadId };
