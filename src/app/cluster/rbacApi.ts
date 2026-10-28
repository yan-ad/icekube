import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SessionRequest } from "./api";

export type UsersRequest = SessionRequest & { readId: number; namespace: string | null };
export type SubjectBinding = { kind: "RoleBinding" | "ClusterRoleBinding"; name: string; namespace: string | null; uid: string; resourceVersion: string; roleRef: { kind: "Role" | "ClusterRole"; name: string } };
export type SubjectRecord = { id: string; kind: "User" | "Group" | "ServiceAccount"; name: string; namespace: string | null; bindings: SubjectBinding[]; bindingsTruncated: boolean };
export const usersSources = ["roleBindings", "clusterRoleBindings", "serviceAccounts"] as const;
export type UsersPageData = UsersRequest & { items: SubjectRecord[]; coverage: { resource: typeof usersSources[number]; state: "complete" | "partial" | "denied" | "unavailable" }[]; truncated: boolean; fetchedAt: number };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const closed = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(key => keys.includes(key));
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.trim() === v && new TextEncoder().encode(v).length <= max && !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(v);
export const validUsersNamespace = (v: unknown): v is string => typeof v === "string" && v.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(v);
const objectName = (v: unknown): v is string => text(v, 253) && v !== "." && v !== ".." && !/[\s/%?#]/.test(v);
const validRequest = (r: UsersRequest) => text(r.clusterId, 256) && text(r.sessionId, 256) && Number.isSafeInteger(r.readId) && r.readId > 0 && (r.namespace === null || validUsersNamespace(r.namespace));
export function parseUsersPage(value: unknown, request: UsersRequest): UsersPageData {
  if (!record(value) || !closed(value, ["clusterId", "sessionId", "readId", "namespace", "items", "coverage", "truncated", "fetchedAt"]) || value.clusterId !== request.clusterId || value.sessionId !== request.sessionId || value.readId !== request.readId || value.namespace !== request.namespace || typeof value.truncated !== "boolean" || !Number.isSafeInteger(value.fetchedAt) || (value.fetchedAt as number) < 0 || !Array.isArray(value.items) || value.items.length > 1000 || !Array.isArray(value.coverage) || value.coverage.length !== 3) throw "invalidResponse";
  const sources = new Set<string>(usersSources);
  for (const coverage of value.coverage) if (!record(coverage) || !closed(coverage, ["resource", "state"]) || typeof coverage.resource !== "string" || !sources.delete(coverage.resource) || !["complete", "partial", "denied", "unavailable"].includes(coverage.state as string)) throw "invalidResponse";
  const ids = new Set<string>();
  for (const row of value.items) {
    if (!record(row) || !closed(row, ["id", "kind", "name", "namespace", "bindings", "bindingsTruncated"]) || !["User", "Group", "ServiceAccount"].includes(row.kind as string) || !text(row.name, 1024) || row.id !== JSON.stringify([row.kind, row.namespace, row.name]) || ids.has(row.id as string) || typeof row.bindingsTruncated !== "boolean" || !Array.isArray(row.bindings) || row.bindings.length > 64 || (row.kind === "ServiceAccount" ? !validUsersNamespace(row.namespace) || !objectName(row.name) || !row.name.split(".").every(validUsersNamespace) : row.namespace !== null)) throw "invalidResponse";
    ids.add(row.id as string);
    const bindings = new Set<string>();
    for (const link of row.bindings) {
      if (!record(link) || !closed(link, ["kind", "name", "namespace", "uid", "resourceVersion", "roleRef"]) || !["RoleBinding", "ClusterRoleBinding"].includes(link.kind as string) || !objectName(link.name) || !text(link.uid, 256) || !text(link.resourceVersion, 256) || !record(link.roleRef) || !closed(link.roleRef, ["kind", "name"]) || !["Role", "ClusterRole"].includes(link.roleRef.kind as string) || !objectName(link.roleRef.name) || (link.kind === "RoleBinding" ? !validUsersNamespace(link.namespace) || request.namespace !== null && link.namespace !== request.namespace : link.namespace !== null || link.roleRef.kind !== "ClusterRole")) throw "invalidResponse";
      const key = JSON.stringify([link.kind, link.namespace, link.name]);
      if (bindings.has(key)) throw "invalidResponse";
      bindings.add(key);
    }
  }
  return value as UsersPageData;
}
export async function loadUsers(request: UsersRequest): Promise<UsersPageData> {
  request = { ...request };
  if (!validRequest(request)) throw "invalidInput";
  if (!isTauri()) throw "connectionFailed";
  return parseUsersPage(await invoke<unknown>("cluster_rbac_users", { request }), request);
}
export async function cancelUsers(request: UsersRequest): Promise<void> {
  if (!validRequest(request)) throw "invalidInput";
  if (isTauri()) await invoke("cluster_rbac_users_cancel", { request });
}
