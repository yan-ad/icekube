import { invoke, hasEngine as isTauri } from "../engine";
import type { SessionRequest } from "./api";
import { validUsersNamespace } from "./rbacApi";

export { validUsersNamespace };
export type ClusterAccess = "none" | "read" | "write";
export type Operation = "create" | "update" | "delete";
export type TemplateIdentity = { name: string; uid: string; resourceVersion: string };
export type Assignment = { templateName: string; templateUid: string; templateResourceVersion: string; namespaces: string[]; allNamespaces: boolean };
export type ManagedUser = { name: string; namespace: string; uid: string | null; resourceVersion: string | null; assignments: Assignment[]; clusterAccess: ClusterAccess; clusterTemplate: TemplateIdentity | null };
export type Rule = { apiGroups: string[]; resources: string[]; verbs: string[]; resourceNames: string[]; nonResourceURLs: string[] };
export type ManagedTemplate = TemplateIdentity & { scope: "namespaced" | "cluster"; rules: Rule[] };
export type ManagementRequest = SessionRequest & { readId: number; namespace: string };
export type CancelRequest = SessionRequest & { readId: number };
export type ManagementSnapshot = ManagementRequest & { users: ManagedUser[]; templates: ManagedTemplate[]; truncated: boolean; fetchedAt: number };
export type PlanRequest = CancelRequest & { operation: Operation; user: ManagedUser };
export type PlanSummary = Rule & { namespaces: string[] | null };
export type PlanStep = { operation: Operation; kind: "ServiceAccount" | "RoleBinding" | "ClusterRoleBinding"; name: string; namespace: string | null };
export type UserPlan = PlanRequest & { planId: string; expiresAt: number; summary: PlanSummary[]; steps: PlanStep[]; warnings: string[] };
export type ApplyRequest = CancelRequest & { planId: string };
export type ApplyResult = PlanStep & { state: "applied" | "failed" | "notSubmitted"; messageCode: string };
export type ApplyResponse = ApplyRequest & { operation: Operation; results: ApplyResult[]; complete: boolean };
const NS_PREFIX = "template-namespaced-resources___";
const CLUSTER_PREFIX = "template-cluster-resources___";
const encoder = new TextEncoder();
const safeText = (v: unknown, max = 253, empty = false): v is string => typeof v === "string" && (empty || v.length > 0) && v.trim() === v && encoder.encode(v).length <= max && !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(v);
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const closed = (v: unknown, keys: string[]): v is Record<string, unknown> => obj(v) && Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
const array = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const name = (v: unknown): v is string => safeText(v) && v !== "." && v !== ".." && !/[\s/%?#]/.test(v);
const operation = (v: unknown): v is Operation => v === "create" || v === "update" || v === "delete";
const strings = (v: unknown, max = 128, empty = false): v is string[] => array(v, max) && v.every(s => safeText(s, 2048, empty));
const namespaces = (v: unknown): v is string[] => array(v, 32) && v.every(validUsersNamespace) && new Set(v).size === v.length;
const identity = (v: unknown, prefix: string): v is TemplateIdentity => closed(v, ["name", "uid", "resourceVersion"]) && name(v.name) && v.name.startsWith(prefix) && safeText(v.uid) && safeText(v.resourceVersion);
const rule = (v: unknown): v is Rule => closed(v, ["apiGroups", "resources", "verbs", "resourceNames", "nonResourceURLs"]) && strings(v.apiGroups, 128, true) && strings(v.resources) && v.resources.every(r => safeText(r, 253)) && strings(v.verbs) && v.verbs.length > 0 && v.verbs.every(verb => safeText(verb, 253)) && strings(v.resourceNames) && strings(v.nonResourceURLs) && v.nonResourceURLs.every(url => url.startsWith("/")) && (v.resources.length > 0 ? v.apiGroups.length > 0 && v.nonResourceURLs.length === 0 : v.nonResourceURLs.length > 0 && v.apiGroups.length === 0 && v.resourceNames.length === 0);
const bounded = (v: unknown, max = 2 * 1024 * 1024) => { try { const raw = JSON.stringify(v); return typeof raw === "string" && encoder.encode(raw).length <= max; } catch { return false; } };
export function validManagedUser(v: unknown): v is ManagedUser {
  if (!closed(v, ["name", "namespace", "uid", "resourceVersion", "assignments", "clusterAccess", "clusterTemplate"]) || !safeText(v.name) || !v.name.split(".").every(validUsersNamespace) || !validUsersNamespace(v.namespace) || (v.uid === null ? v.resourceVersion !== null : !safeText(v.uid) || !safeText(v.resourceVersion)) || !array(v.assignments, 32)) return false;
  const templates = new Set<string>();
  for (const a of v.assignments) {
    if (!closed(a, ["templateName", "templateUid", "templateResourceVersion", "namespaces", "allNamespaces"]) || !name(a.templateName) || !a.templateName.startsWith(NS_PREFIX) || !safeText(a.templateUid) || !safeText(a.templateResourceVersion) || !namespaces(a.namespaces) || typeof a.allNamespaces !== "boolean" || a.allNamespaces === (a.namespaces.length > 0) || templates.has(a.templateName)) return false;
    templates.add(a.templateName);
  }
  return bounded(v, 64 * 1024) && (v.clusterAccess === "none" ? v.clusterTemplate === null : (v.clusterAccess === "read" || v.clusterAccess === "write") && identity(v.clusterTemplate, CLUSTER_PREFIX));
}
const session = (v: CancelRequest) => safeText(v.clusterId, 256) && safeText(v.sessionId, 256) && integer(v.readId) && v.readId > 0;
const scoped = (v: Record<string, unknown>, r: CancelRequest) => v.clusterId === r.clusterId && v.sessionId === r.sessionId && v.readId === r.readId;
const step = (v: unknown): v is PlanStep => closed(v, ["operation", "kind", "name", "namespace"]) && stepFields(v);
const stepFields = (v: Record<string, unknown>) => operation(v.operation) && name(v.name) && (v.kind === "ServiceAccount" || v.kind === "RoleBinding" ? validUsersNamespace(v.namespace) : v.kind === "ClusterRoleBinding" && v.namespace === null);
function invalid(): never { throw "invalidResponse"; }
export function parseManagementSnapshot(value: unknown, r: ManagementRequest): ManagementSnapshot {
  if (!bounded(value) || !closed(value, ["clusterId", "sessionId", "readId", "namespace", "users", "templates", "truncated", "fetchedAt"]) || !scoped(value, r) || value.namespace !== r.namespace || !array(value.users, 100) || !array(value.templates, 64) || typeof value.truncated !== "boolean" || !integer(value.fetchedAt)) invalid();
  const names = new Set<string>();
  for (const u of value.users) { if (!validManagedUser(u) || u.namespace !== r.namespace || u.uid === null || names.has(u.name)) invalid(); names.add(u.name); }
  names.clear();
  for (const t of value.templates) {
    if (!closed(t, ["name", "uid", "resourceVersion", "scope", "rules"]) || (t.scope !== "namespaced" && t.scope !== "cluster") || !identity({ name: t.name, uid: t.uid, resourceVersion: t.resourceVersion }, t.scope === "namespaced" ? NS_PREFIX : CLUSTER_PREFIX) || !array(t.rules, 32) || !t.rules.every(rule) || names.has(t.name as string)) invalid();
    names.add(t.name as string);
  }
  return value as ManagementSnapshot;
}
export function serializePlanRequest(r: PlanRequest): PlanRequest {
  if (!closed(r, ["clusterId", "sessionId", "readId", "operation", "user"]) || !session(r) || !operation(r.operation) || !validManagedUser(r.user) || (r.operation === "create") !== (r.user.uid === null)) throw "invalidInput";
  return JSON.parse(JSON.stringify(r)) as PlanRequest;
}
export function parseUserPlan(value: unknown, r: PlanRequest): UserPlan {
  if (!bounded(value) || !closed(value, ["clusterId", "sessionId", "readId", "planId", "expiresAt", "operation", "user", "summary", "steps", "warnings"]) || !scoped(value, r) || value.operation !== r.operation || !validManagedUser(value.user) || JSON.stringify(value.user) !== JSON.stringify(r.user) || !safeText(value.planId, 64) || !/^[a-f0-9]{32}$/.test(value.planId) || !integer(value.expiresAt) || !array(value.summary, 1056) || !array(value.steps, 128) || !value.steps.every(step) || !strings(value.warnings, 128)) invalid();
  for (const s of value.summary) if (!closed(s, ["apiGroups", "resources", "verbs", "resourceNames", "nonResourceURLs", "namespaces"]) || !rule({ apiGroups: s.apiGroups, resources: s.resources, verbs: s.verbs, resourceNames: s.resourceNames, nonResourceURLs: s.nonResourceURLs }) || (s.namespaces !== null && !namespaces(s.namespaces))) invalid();
  return value as UserPlan;
}
const codes = new Set(["applied", "previousStepFailed", "InvalidInput", "InvalidResponse", "LimitExceeded", "Conflict", "Busy", "StaleSession", "NotFound", "NotConnected", "StoreUnavailable", "PermissionDenied", "PermissionReviewUnavailable", "AuthFailed", "Network", "Timeout", "ConnectionFailed", "ResourceUnavailable", "ProcessUnavailable", "KubeconfigUnavailable", "KubeconfigInvalid", "SourceChanged", "UnsupportedAuth", "AuthHelperMissing", "AuthHelperFailed", "AuthHelperInvalidResponse", "AuthInteractiveRequired", "AuthExpired", "InsecureTransport", "TlsFailed", "HelmUnavailable"]);
export function parseApplyResponse(value: unknown, r: ApplyRequest, plan: UserPlan): ApplyResponse {
  if (!bounded(value) || !closed(value, ["clusterId", "sessionId", "readId", "planId", "operation", "results", "complete"]) || !scoped(value, r) || value.planId !== r.planId || value.operation !== plan.operation || !array(value.results, 128) || value.results.length !== plan.steps.length || typeof value.complete !== "boolean") invalid();
  let failed = false;
  for (let i = 0; i < value.results.length; i++) {
    const row = value.results[i], expected = plan.steps[i];
    if (!closed(row, ["operation", "kind", "name", "namespace", "state", "messageCode"]) || !stepFields(row) || row.operation !== expected.operation || row.kind !== expected.kind || row.name !== expected.name || row.namespace !== expected.namespace || !codes.has(row.messageCode as string)) invalid();
    if (failed ? row.state !== "notSubmitted" || row.messageCode !== "previousStepFailed" : row.state === "failed" ? row.messageCode === "applied" || row.messageCode === "previousStepFailed" : row.state !== "applied" || row.messageCode !== "applied") invalid();
    if (row.state === "failed") failed = true;
  }
  if (value.complete === failed) invalid();
  return value as ApplyResponse;
}
export async function loadManagedUsers(r: ManagementRequest) {
  if (!closed(r, ["clusterId", "sessionId", "readId", "namespace"]) || !session(r) || !validUsersNamespace(r.namespace)) throw "invalidInput";
  if (!isTauri()) throw "connectionFailed";
  return parseManagementSnapshot(await invoke<unknown>("cluster_rbac_management_snapshot", { request: { ...r } }), r);
}
export async function planManagedUser(r: PlanRequest) {
  const request = serializePlanRequest(r);
  if (!isTauri()) throw "connectionFailed";
  return parseUserPlan(await invoke<unknown>("cluster_rbac_user_plan", { request }), request);
}
export async function applyManagedUser(r: ApplyRequest, plan: UserPlan) {
  if (!closed(r, ["clusterId", "sessionId", "readId", "planId"]) || !session(r) || r.clusterId !== plan.clusterId || r.sessionId !== plan.sessionId || r.planId !== plan.planId || r.readId <= plan.readId || plan.expiresAt <= Date.now()) throw "invalidInput";
  if (!isTauri()) throw "connectionFailed";
  return parseApplyResponse(await invoke<unknown>("cluster_rbac_user_apply", { request: { ...r } }), r, plan);
}
export async function cancelManagedUsers(r: CancelRequest) {
  const request = { clusterId: r.clusterId, sessionId: r.sessionId, readId: r.readId };
  if (!session(request)) throw "invalidInput";
  if (isTauri()) await invoke("cluster_rbac_management_cancel", { request });
}
export function readOnlyTemplate(t: ManagedTemplate) {
  return t.scope === "cluster" && t.rules.every(r => rule(r) && (r.nonResourceURLs.length > 0 ? r.verbs.every(v => v === "get") : r.verbs.every(v => ["get", "list", "watch"].includes(v)) && r.apiGroups.every(group => !group.includes("*")) && r.resources.every(resource => !resource.includes("*") && !resource.split("/").some(segment => ["exec", "attach", "portforward", "proxy"].includes(segment)))));
}
