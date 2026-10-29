import { invoke, hasEngine as isTauri } from "../engine";
import { errorCode, connectionMessage, type SessionRequest } from "./api";

export type PodIdentity = { namespace: string; name: string; uid?: string };
export type PodRequest = SessionRequest & PodIdentity;
export type PodMode = "details" | "logs" | "shell" | "attach" | "edit" | "forward";
export type PodContainer = { name: string; image: string; kind: "container" | "init" | "ephemeral"; state: string; ready: boolean; restarts: number; ports: { name: string | null; port: number; protocol: string }[] };
export type PodEventsState = "complete" | "partial" | "denied" | "unavailable";
export type PodDetails = PodRequest & { uid: string; resourceVersion: string; phase: string; node: string | null; podIps: string[]; hostIps: string[]; serviceAccount: string | null; qos: string | null; createdAt: string | null; deletionTimestamp: string | null; containers: PodContainer[]; conditions: { type: string; status: string }[]; yaml: string; events: { type: string; reason: string; count: number; lastSeen: string | null }[]; eventsState: PodEventsState };
export type PodMutation = "delete" | "forceDelete" | "finalize" | "replace";
export type PodStreamRequest = SessionRequest & { streamId: string };
export type PodStartRequest = PodRequest & { uid: string; container: string; mode: "logs" | "shell" | "attach"; previous: boolean; timestamps: boolean; tailLines: number; shell?: string | null };
export type PodStreamSnapshot = PodStreamRequest & { sequence: number; output: string; status: "opening" | "running" | "exited" | "error"; error: string | null; truncated: boolean };
export type PodForward = SessionRequest & { id: string; namespace: string; name: string; remotePort: number; localPort: number; status: string; error: string | null };
const bytes = (s: string) => new TextEncoder().encode(s).length;
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 4096): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v);
const nullable = (v: unknown) => v === null || text(v);
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const array = (v: unknown, max: number, test: (v: unknown) => boolean) => Array.isArray(v) && v.length <= max && v.every(test);
function session(r: SessionRequest) { if (!text(r.clusterId, 256) || !text(r.sessionId, 256)) throw "invalidInput"; }
function pod(r: PodRequest, uid = false) {
  session(r);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(r.namespace) || r.name.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(r.name) || (uid && !text(r.uid, 256)) || (r.uid !== undefined && !text(r.uid, 256))) throw "invalidInput";
}
const scope = (v: Record<string, unknown>, r: SessionRequest) => v.clusterId === r.clusterId && v.sessionId === r.sessionId;
export function podMessage(reason: unknown): string {
  if (reason === "conflict") return "The Pod changed or was replaced. Reload details before trying again; your edit has not been applied.";
  if (reason === "processUnavailable") return "The container process is unavailable. Check the container state or choose another shell.";
  return connectionMessage(errorCode(reason));
}
async function command(name: string, request: object): Promise<unknown> {
  if (!isTauri()) throw "notConnected";
  try { return await invoke(name, { request }); }
  catch (e) { if (e === "conflict" || e === "processUnavailable") throw e; throw errorCode(e); }
}
async function unit(name: string, request: object) { const v = await command(name, request); if (v !== null && v !== undefined) throw "invalidResponse"; }
export async function podDetail(r: PodRequest): Promise<PodDetails> {
  pod(r);
  const v = await command("cluster_pod_detail", r);
  if (!record(v) || !scope(v, r) || v.namespace !== r.namespace || v.name !== r.name || !text(v.uid, 256) || (r.uid !== undefined && v.uid !== r.uid) || !text(v.resourceVersion, 256) || !text(v.phase) || ![v.node, v.serviceAccount, v.qos, v.createdAt, v.deletionTimestamp].every(nullable)
    || !array(v.podIps, 64, x => text(x, 128)) || !array(v.hostIps, 64, x => text(x, 128)) || typeof v.yaml !== "string" || bytes(v.yaml) > 1048576
    || !array(v.containers, 256, c => record(c) && text(c.name, 253) && text(c.image) && ["container", "init", "ephemeral"].includes(c.kind as string) && text(c.state) && typeof c.ready === "boolean" && integer(c.restarts) && array(c.ports, 256, p => record(p) && nullable(p.name) && integer(p.port, 1, 65535) && text(p.protocol, 32)))
    || !array(v.conditions, 256, c => record(c) && text(c.type) && text(c.status)) || !array(v.events, 256, e => record(e) && text(e.type) && text(e.reason) && integer(e.count) && nullable(e.lastSeen))
    || "eventsState" in v && !["complete", "partial", "denied", "unavailable"].includes(v.eventsState as string)) throw "invalidResponse";
  return { ...v, eventsState: "eventsState" in v ? v.eventsState : "unavailable" } as PodDetails;
}
export async function podMutate(r: PodDetails, action: PodMutation, yaml?: string) {
  pod(r, true);
  if (!text(r.resourceVersion, 256) || !["delete", "forceDelete", "finalize", "replace"].includes(action) || action === "replace" && (typeof yaml !== "string" || bytes(yaml) > 1048576)) throw "invalidInput";
  await unit("cluster_pod_mutate", { clusterId: r.clusterId, sessionId: r.sessionId, namespace: r.namespace, name: r.name, uid: r.uid, resourceVersion: r.resourceVersion, action, yaml: yaml ?? null });
}
function stream(r: PodStreamRequest) { session(r); if (!text(r.streamId, 256)) throw "invalidInput"; }
function snapshot(v: unknown, r: SessionRequest & { streamId?: string }): PodStreamSnapshot {
  if (!record(v) || !scope(v, r) || !text(v.streamId, 256) || r.streamId !== undefined && v.streamId !== r.streamId || !integer(v.sequence) || typeof v.output !== "string" || bytes(v.output) > 65536 || !["opening", "running", "exited", "error"].includes(v.status as string) || !(v.error === null || text(v.error, 128)) || typeof v.truncated !== "boolean" || v.status === "error" && v.error === null) throw "invalidResponse";
  return v as PodStreamSnapshot;
}
export async function podStreamOpen(r: PodStartRequest) {
  pod(r, true);
  if (!text(r.container, 253) || !["logs", "shell", "attach"].includes(r.mode) || typeof r.previous !== "boolean" || typeof r.timestamps !== "boolean" || !integer(r.tailLines, 0, 10000) || r.shell != null && !["bash", "sh", "ash", "powershell", "cmd"].includes(r.shell)) throw "invalidInput";
  const v = await command("cluster_pod_stream_open", r);
  try { return snapshot(v, r); } catch (e) {
    if (record(v) && scope(v, r) && text(v.streamId, 256)) void podStreamClose({ clusterId: r.clusterId, sessionId: r.sessionId, streamId: v.streamId }).catch(() => {});
    throw e;
  }
}
export async function podStreamRead(r: PodStreamRequest) { stream(r); return snapshot(await command("cluster_pod_stream_read", r), r); }
export async function podStreamClose(r: PodStreamRequest) { stream(r); await unit("cluster_pod_stream_close", r); }
export async function podStreamWrite(r: PodStreamRequest, data: string) { stream(r); if (bytes(data) > 16384) throw "limitExceeded"; await unit("cluster_pod_stream_write", { ...r, data }); }
export async function podStreamResize(r: PodStreamRequest, cols: number, rows: number) { stream(r); if (!integer(cols, 1, 1000) || !integer(rows, 1, 1000)) throw "invalidInput"; await unit("cluster_pod_stream_resize", { ...r, cols, rows }); }
function forward(v: unknown, r: SessionRequest): PodForward {
  if (!record(v) || !scope(v, r) || !text(v.id, 256) || !text(v.namespace, 63) || !text(v.name, 253) || !integer(v.remotePort, 1, 65535) || !integer(v.localPort, 1, 65535) || !["opening", "running", "stopped", "error"].includes(v.status as string) || !(v.error === null || text(v.error, 128))) throw "invalidResponse";
  pod({ ...r, namespace: v.namespace, name: v.name });
  return v as PodForward;
}
export async function podForwardStart(r: PodRequest & { uid: string; remotePort: number; localPort: number }) {
  pod(r, true); if (!integer(r.remotePort, 1, 65535) || !integer(r.localPort, 0, 65535)) throw "invalidInput";
  const raw = await command("cluster_pod_forward_start", r);
  let v: PodForward;
  try { v = forward(raw, r); } catch (e) {
    if (record(raw) && scope(raw, r) && text(raw.id, 256)) void podForwardStop({ ...r, id: raw.id }).catch(() => {});
    throw e;
  }
  if (v.namespace !== r.namespace || v.name !== r.name || v.remotePort !== r.remotePort || r.localPort !== 0 && v.localPort !== r.localPort) { void podForwardStop({ ...r, id: v.id }).catch(() => {}); throw "invalidResponse"; }
  return v;
}
export async function podForwardList(r: SessionRequest) { session(r); const v = await command("cluster_pod_forward_list", r); if (!Array.isArray(v) || v.length > 8) throw "invalidResponse"; return v.map(x => forward(x, r)); }
export async function podForwardStop(r: SessionRequest & { id: string }) { session(r); if (!text(r.id, 256)) throw "invalidInput"; await unit("cluster_pod_forward_stop", { clusterId: r.clusterId, sessionId: r.sessionId, id: r.id }); }
