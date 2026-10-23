/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
import { getRequestChannel } from "../../../../packages/technical-features/messaging/messaging/src/features/actual/request/get-request-channel";

export interface PodsRequest {
  clusterId: string;
  namespace: string | null;
}
export type PodsError =
  | "CLUSTER_NOT_FOUND"
  | "CONFIG_UNAVAILABLE"
  | "AUTH_FAILED"
  | "FORBIDDEN"
  | "TIMEOUT"
  | "TLS_ERROR"
  | "UNAVAILABLE"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_RESPONSE";
export interface PodSummary {
  uid: string;
  name: string;
  namespace: string;
  nodeName: string | null;
  createdAt: string | null;
  phase: string;
  status: string;
  readyContainers: number;
  totalContainers: number;
  restartCount: number;
  containers: {
    name: string;
    ready: boolean;
    state: "running" | "waiting" | "terminated" | "unknown";
    init: boolean;
  }[];
  owner: { kind: string; name: string } | null;
  cpu: number | null;
  memory: number | null;
}
export interface PodsSnapshot {
  protocolVersion: 1;
  clusterId: string;
  namespace: string | null;
  pods: PodSummary[];
  namespaces: string[];
  truncated: boolean;
  warnings: string[];
  error: PodsError | null;
}
export const podsListChannel = getRequestChannel<PodsRequest, PodsSnapshot>("pods.list");
export const podsErrorCodes: readonly PodsError[] = [
  "CLUSTER_NOT_FOUND",
  "CONFIG_UNAVAILABLE",
  "AUTH_FAILED",
  "FORBIDDEN",
  "TIMEOUT",
  "TLS_ERROR",
  "UNAVAILABLE",
  "RESPONSE_TOO_LARGE",
  "INVALID_RESPONSE",
];
// Only non-sensitive, application-authored diagnostics may cross the bridge.
export const podsWarnings = ["Pod list truncated", "Namespace list unavailable", "Metrics unavailable"] as const;
export const maxPods = 1000;
export const maxPodContainers = 256;
export const maxPodsWarnings = 32;
export const maxPodsPayloadBytes = 1024 * 1024;
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("Invalid Pods fields");
  return value as Record<string, unknown>;
}
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096;
const nullableText = (v: unknown) => v === null || text(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const metric = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
export const isPodsNamespace = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(v);
export function parsePodsRequest(value: unknown): PodsRequest {
  const d = record(value, ["clusterId", "namespace"]);
  if (
    typeof d.clusterId !== "string" ||
    !/^[a-f0-9]{32}$/.test(d.clusterId) ||
    !(d.namespace === null || isPodsNamespace(d.namespace))
  )
    throw new Error("Invalid Pods request");
  return { clusterId: d.clusterId, namespace: d.namespace };
}
export function parsePodsSnapshot(value: unknown, request?: PodsRequest): PodsSnapshot {
  const d = record(value, [
    "protocolVersion",
    "clusterId",
    "namespace",
    "pods",
    "namespaces",
    "truncated",
    "warnings",
    "error",
  ]);
  const scope = parsePodsRequest({ clusterId: d.clusterId, namespace: d.namespace });
  if (
    d.protocolVersion !== 1 ||
    (request && (scope.clusterId !== request.clusterId || scope.namespace !== request.namespace)) ||
    !Array.isArray(d.pods) ||
    d.pods.length > maxPods ||
    !Array.isArray(d.namespaces) ||
    d.namespaces.length > 1000 ||
    !d.namespaces.every(isPodsNamespace) ||
    typeof d.truncated !== "boolean" ||
    !Array.isArray(d.warnings) ||
    d.warnings.length > maxPodsWarnings ||
    !d.warnings.every((v) => (podsWarnings as readonly unknown[]).includes(v)) ||
    !(d.error === null || podsErrorCodes.includes(d.error as PodsError))
  )
    throw new Error("Invalid Pods snapshot");
  const uids = new Set<string>();
  for (const item of d.pods) {
    const p = record(item, [
      "uid",
      "name",
      "namespace",
      "nodeName",
      "createdAt",
      "phase",
      "status",
      "readyContainers",
      "totalContainers",
      "restartCount",
      "containers",
      "owner",
      "cpu",
      "memory",
    ]);
    if (
      ![p.uid, p.name, p.phase, p.status].every(text) ||
      !isPodsNamespace(p.namespace) ||
      (scope.namespace !== null && p.namespace !== scope.namespace) ||
      !nullableText(p.nodeName) ||
      !nullableText(p.createdAt) ||
      !count(p.readyContainers) ||
      !count(p.totalContainers) ||
      p.readyContainers > p.totalContainers ||
      !count(p.restartCount) ||
      !Array.isArray(p.containers) ||
      p.containers.length > maxPodContainers ||
      !metric(p.cpu) ||
      !metric(p.memory) ||
      uids.has(p.uid as string)
    )
      throw new Error("Invalid Pod summary");
    uids.add(p.uid as string);
    for (const item of p.containers) {
      const c = record(item, ["name", "ready", "state", "init"]);
      if (
        !text(c.name) ||
        typeof c.ready !== "boolean" ||
        typeof c.init !== "boolean" ||
        !["running", "waiting", "terminated", "unknown"].includes(c.state as string)
      )
        throw new Error("Invalid Pod container");
    }
    if (p.owner !== null) {
      const o = record(p.owner, ["kind", "name"]);
      if (!text(o.kind) || !text(o.name)) throw new Error("Invalid Pod owner");
    }
  }
  if (d.error !== null && d.pods.length !== 0) throw new Error("Invalid Pods error snapshot");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxPodsPayloadBytes)
    throw new Error("Pods payload exceeds limit");
  return d as unknown as PodsSnapshot;
}
