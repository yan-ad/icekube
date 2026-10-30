import { invoke, hasEngine } from "../engine";
import { errorCode, type SessionRequest } from "./api";
import type { ResourceReference } from "./detailApi";

export type DrainCancel = SessionRequest & { operationId: number };
export type DrainReviewRequest = DrainCancel & { reference: ResourceReference; resourceVersion: string };
export type DrainExecuteRequest = DrainCancel & { planId: string };
export type DrainPod = { name: string; namespace: string; uid: string; resourceVersion: string; disposition: "evict" | "skip" | "wait" | "block"; reason: "managed" | "daemonSet" | "mirror" | "terminating" | "unmanaged" | "localData" | "unsupportedController" | "controllerUnavailable" };
export type DrainReview = DrainReviewRequest & { planId: string | null; expiresAt: number | null; pods: DrainPod[]; canDrain: boolean; partial: boolean };
export type DrainOutcome = { name: string; namespace: string; uid: string; state: "evicted" | "gone" | "pending" | "blocked" | "skipped" | "uncertain" | "notSubmitted"; reason: "disruptionBudget" | "permissionDenied" | "conflict" | "unavailable" | "cancelled" | "timeout" | "newPods" | null };
export type DrainResult = DrainCancel & { reference: ResourceReference; cordoned: boolean; state: "complete" | "blocked" | "partial" | "cancelled" | "timeout" | "uncertain"; pods: DrainOutcome[] };
function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function keys(v: Record<string, unknown>, fields: string[]) { return Object.keys(v).length === fields.length && fields.every(k => Object.prototype.hasOwnProperty.call(v, k)); }
function token(v: unknown): v is string { return typeof v === "string" && v.length > 0 && v.length <= 256 && /^[\x21-\x7e]+$/.test(v); }
function name(v: unknown): v is string { return typeof v === "string" && v.length <= 253 && v.split(".").every(s => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)); }
function namespace(v: unknown): v is string { return name(v) && v.length <= 63 && !v.includes("."); }
function reference(v: unknown): v is ResourceReference { return record(v) && keys(v, ["kind", "namespace", "name", "uid"]) && v.kind === "nodes" && v.namespace === null && name(v.name) && token(v.uid); }
function scope(v: Record<string, unknown>) { return token(v.clusterId) && token(v.sessionId) && Number.isSafeInteger(v.operationId) && (v.operationId as number) > 0; }
function sameScope(v: Record<string, unknown>, r: DrainCancel) { return scope(v) && v.clusterId === r.clusterId && v.sessionId === r.sessionId && v.operationId === r.operationId; }
function sameReference(v: unknown, r: ResourceReference): v is ResourceReference { return reference(v) && (["kind", "namespace", "name", "uid"] as const).every(k => v[k] === r[k]); }
function bounded(v: unknown) { try { return new TextEncoder().encode(JSON.stringify(v)).length <= 65536; } catch { return false; } }
function podIdentity(v: Record<string, unknown>) { return name(v.name) && namespace(v.namespace) && token(v.uid); }
function unique(pods: { namespace: string; name: string; uid: string }[]) { return new Set(pods.map(p => `${p.namespace}/${p.name}/${p.uid}`)).size === pods.length; }
function oneOf(v: unknown, values: string[]): v is string { return typeof v === "string" && values.includes(v); }
export function validDrainReviewRequest(v: unknown): v is DrainReviewRequest { return record(v) && keys(v, ["clusterId", "sessionId", "operationId", "reference", "resourceVersion"]) && scope(v) && reference(v.reference) && token(v.resourceVersion); }
function validExecute(v: unknown): v is DrainExecuteRequest { return record(v) && keys(v, ["clusterId", "sessionId", "operationId", "planId"]) && scope(v) && typeof v.planId === "string" && /^[a-f0-9]{32}$/.test(v.planId); }
export function parseDrainReview(v: unknown, r: DrainReviewRequest): DrainReview {
  if (!validDrainReviewRequest(r) || !record(v) || !bounded(v) || !keys(v, ["clusterId", "sessionId", "operationId", "reference", "resourceVersion", "planId", "expiresAt", "pods", "canDrain", "partial"]) || !sameScope(v, r) || !sameReference(v.reference, r.reference) || v.resourceVersion !== r.resourceVersion || typeof v.canDrain !== "boolean" || typeof v.partial !== "boolean" || !Array.isArray(v.pods) || v.pods.length > 100) throw "invalidResponse";
  const pods: DrainPod[] = v.pods.map(p => {
    if (!record(p) || !keys(p, ["name", "namespace", "uid", "resourceVersion", "disposition", "reason"]) || !podIdentity(p) || !token(p.resourceVersion) || !oneOf(p.disposition, ["evict", "skip", "wait", "block"]) || !oneOf(p.reason, ["managed", "daemonSet", "mirror", "terminating", "unmanaged", "localData", "unsupportedController", "controllerUnavailable"])) throw "invalidResponse";
    return { name: p.name as string, namespace: p.namespace as string, uid: p.uid as string, resourceVersion: p.resourceVersion, disposition: p.disposition as DrainPod["disposition"], reason: p.reason as DrainPod["reason"] };
  });
  if (!unique(pods) || (v.canDrain ? v.partial || pods.some(p => p.disposition === "block") || typeof v.planId !== "string" || !/^[a-f0-9]{32}$/.test(v.planId) || !Number.isSafeInteger(v.expiresAt) || (v.expiresAt as number) <= 0 : v.planId !== null || v.expiresAt !== null)) throw "invalidResponse";
  return { clusterId: r.clusterId, sessionId: r.sessionId, operationId: r.operationId, reference: { ...v.reference }, resourceVersion: r.resourceVersion, pods, planId: v.planId as string | null, expiresAt: v.expiresAt as number | null, canDrain: v.canDrain, partial: v.partial };
}
export function parseDrainResult(v: unknown, r: DrainExecuteRequest, review: DrainReview): DrainResult {
  if (!validExecute(r) || !review.canDrain || review.planId !== r.planId || review.clusterId !== r.clusterId || review.sessionId !== r.sessionId || !record(v) || !bounded(v) || !keys(v, ["clusterId", "sessionId", "operationId", "reference", "cordoned", "state", "pods"]) || !sameScope(v, r) || !sameReference(v.reference, review.reference) || typeof v.cordoned !== "boolean" || !oneOf(v.state, ["complete", "blocked", "partial", "cancelled", "timeout", "uncertain"]) || !Array.isArray(v.pods) || v.pods.length > 100) throw "invalidResponse";
  const pods: DrainOutcome[] = v.pods.map(p => {
    if (!record(p) || !keys(p, ["name", "namespace", "uid", "state", "reason"]) || !podIdentity(p) || !oneOf(p.state, ["evicted", "gone", "pending", "blocked", "skipped", "uncertain", "notSubmitted"]) || !(p.reason === null || oneOf(p.reason, ["disruptionBudget", "permissionDenied", "conflict", "unavailable", "cancelled", "timeout", "newPods"]))) throw "invalidResponse";
    const original = review.pods.find(row => row.namespace === p.namespace && row.name === p.name && row.uid === p.uid);
    if ((!original && (p.state !== "blocked" || p.reason !== "newPods")) || (p.state === "skipped" && original?.disposition !== "skip")) throw "invalidResponse";
    return { name: p.name as string, namespace: p.namespace as string, uid: p.uid as string, state: p.state as DrainOutcome["state"], reason: p.reason as DrainOutcome["reason"] };
  });
  if (!unique(pods) || review.pods.some(p => !pods.some(o => o.namespace === p.namespace && o.name === p.name && o.uid === p.uid)) || (v.state === "complete" && (!v.cordoned || pods.some(p => !["evicted", "gone", "skipped"].includes(p.state))))) throw "invalidResponse";
  return { clusterId: r.clusterId, sessionId: r.sessionId, operationId: r.operationId, reference: { ...v.reference }, cordoned: v.cordoned, state: v.state as DrainResult["state"], pods };
}
export async function reviewNodeDrain(request: DrainReviewRequest): Promise<DrainReview> {
  if (!validDrainReviewRequest(request)) throw "invalidInput";
  const snapshot = { ...request, reference: { ...request.reference } };
  if (!hasEngine()) throw "connectionFailed";
  let v: unknown; try { v = await invoke("cluster_node_drain_review", { request: snapshot }); } catch (e) { throw errorCode(e); }
  return parseDrainReview(v, snapshot);
}
export async function executeNodeDrain(request: DrainExecuteRequest, review: DrainReview): Promise<DrainResult> {
  if (!validExecute(request)) throw "invalidInput";
  const snapshot = { ...request };
  if (!hasEngine()) throw "connectionFailed";
  let v: unknown; try { v = await invoke("cluster_node_drain_execute", { request: snapshot }); } catch (e) { throw errorCode(e); }
  return parseDrainResult(v, snapshot, review);
}
export async function cancelNodeDrain(request: DrainCancel): Promise<void> {
  if (!record(request) || !keys(request, ["clusterId", "sessionId", "operationId"]) || !scope(request)) throw "invalidInput";
  if (!hasEngine()) return;
  if (await invoke("cluster_node_drain_cancel", { request: { ...request } }) !== null) throw "invalidResponse";
}
