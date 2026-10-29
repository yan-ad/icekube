import { invoke, hasEngine as isTauri } from "../engine";
import { errorCode, type SessionRequest } from "./api";
import type { ResourceDetail, ResourceReference } from "./detailApi";
import { podForwardStop, type PodForward } from "./podApi";

export type ServiceForwardCancel = SessionRequest & { operationId: number };
export type ServiceForwardRequest = ServiceForwardCancel & { reference: ResourceReference; resourceVersion: string; servicePort: number; localPort: number };
export type ServiceForwardResult = SessionRequest & { reference: ResourceReference; servicePort: number; pod: ResourceReference; forward: PodForward };
function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function keys(v: Record<string, unknown>, fields: string[]) { return Object.keys(v).length === fields.length && fields.every(k => Object.prototype.hasOwnProperty.call(v, k)); }
function identity(v: unknown): v is string { return typeof v === "string" && v.length > 0 && v.length <= 256 && /^[\x21-\x7e]+$/.test(v); }
function dns(v: unknown, max: number): v is string { return typeof v === "string" && v.length <= max && v.split(".").every(p => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(p)); }
function reference(v: unknown, kind: "services" | "pods"): v is ResourceReference {
  return record(v) && keys(v, ["kind", "namespace", "name", "uid"]) && v.kind === kind && dns(v.name, 253)
    && dns(v.namespace, 63) && !v.namespace.includes(".") && identity(v.uid);
}
function integer(v: unknown, min: number): v is number { return typeof v === "number" && Number.isInteger(v) && v >= min && v <= 65535; }
function scope(v: Record<string, unknown>) { return identity(v.clusterId) && identity(v.sessionId) && Number.isSafeInteger(v.operationId) && (v.operationId as number) > 0; }
export function parseLocalPort(value: string): number | null { return value === "" ? 0 : /^\d{1,5}$/.test(value) && integer(Number(value), 0) ? Number(value) : null; }
export function servicePorts(detail: ResourceDetail): number[] {
  if (detail.reference.kind !== "services") return [];
  const sections = detail.sections?.filter(s => s.title === "Service ports") ?? [];
  if (sections.length !== 1) return [];
  const rows = new Map<string, { ports: string[]; protocols: string[] }>();
  for (const f of sections[0].facts) {
    const m = /^(\d+) · (Port|Protocol)$/.exec(f.label); if (!m) continue;
    const row = rows.get(m[1]) ?? { ports: [], protocols: [] };
    (m[2] === "Port" ? row.ports : row.protocols).push(f.value); rows.set(m[1], row);
  }
  const ports = [...rows.values()].filter(r => r.ports.length === 1 && r.protocols.length === 1 && r.protocols[0] === "TCP" && /^\d{1,5}$/.test(r.ports[0])).map(r => Number(r.ports[0])).filter(p => integer(p, 1));
  return ports.filter(p => ports.filter(other => other === p).length === 1).sort((a,b) => a-b);
}
export function validServiceForwardRequest(v: unknown): v is ServiceForwardRequest {
  return record(v) && keys(v, ["clusterId", "sessionId", "operationId", "reference", "resourceVersion", "servicePort", "localPort"])
    && scope(v) && reference(v.reference, "services") && identity(v.resourceVersion) && integer(v.servicePort, 1) && integer(v.localPort, 0);
}
export function parseServiceForwardResult(v: unknown, r: ServiceForwardRequest): ServiceForwardResult {
  if (!validServiceForwardRequest(r) || !record(v) || !keys(v, ["clusterId", "sessionId", "reference", "servicePort", "pod", "forward"])
    || v.clusterId !== r.clusterId || v.sessionId !== r.sessionId || v.servicePort !== r.servicePort || !reference(v.reference, "services")
    || (["kind", "namespace", "name", "uid"] as const).some(k => (v.reference as ResourceReference)[k] !== r.reference[k])
    || !reference(v.pod, "pods") || v.pod.namespace !== r.reference.namespace || !record(v.forward)) throw "invalidResponse";
  const f = v.forward;
  if (!keys(f, ["id", "clusterId", "sessionId", "namespace", "name", "remotePort", "localPort", "status", "error"])
    || !identity(f.id) || f.clusterId !== r.clusterId || f.sessionId !== r.sessionId || f.namespace !== v.pod.namespace || f.name !== v.pod.name
    || !integer(f.remotePort, 1) || !integer(f.localPort, 1) || r.localPort !== 0 && f.localPort !== r.localPort || f.status !== "running" || f.error !== null) throw "invalidResponse";
  return { clusterId: r.clusterId, sessionId: r.sessionId, reference: { ...v.reference }, servicePort: r.servicePort, pod: { ...v.pod }, forward: { ...f } as PodForward };
}
export async function serviceForwardStart(request: ServiceForwardRequest): Promise<ServiceForwardResult> {
  if (!validServiceForwardRequest(request)) throw "invalidInput";
  const snapshot = { ...request, reference: { ...request.reference } };
  if (!isTauri()) throw "notConnected";
  let raw: unknown;
  try { raw = await invoke("cluster_service_forward_start", { request: snapshot }); } catch (reason) { throw errorCode(reason); }
  try { return parseServiceForwardResult(raw, snapshot); } catch (reason) {
    if (record(raw) && record(raw.forward) && raw.forward.clusterId === snapshot.clusterId && raw.forward.sessionId === snapshot.sessionId && identity(raw.forward.id)) {
      await podForwardStop({ clusterId: snapshot.clusterId, sessionId: snapshot.sessionId, id: raw.forward.id }).catch(() => {});
    }
    throw reason;
  }
}
export async function serviceForwardCancel(request: ServiceForwardCancel): Promise<void> {
  if (!record(request) || !keys(request, ["clusterId", "sessionId", "operationId"]) || !scope(request)) throw "invalidInput";
  if (!isTauri()) return;
  if (await invoke("cluster_service_forward_cancel", { request: { ...request } }) !== null) throw "invalidResponse";
}
