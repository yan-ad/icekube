import { invoke, isTauri } from "@tauri-apps/api/core";
import { errorCode, validResourceIdentity, type ResourceItem, type ResourceKind, type SessionRequest } from "./api";
import { parseNode, validTimestamp } from "./nodeContract";
import { resourceViews } from "./resourceViews";

export type ResourceReference = { kind: ResourceKind; namespace: string | null; name: string; uid?: string | null };
export type DetailRequest = SessionRequest & { readId: number; reference: ResourceReference };
export type DetailFact = { label: string; value: string };
export type DetailSection = { title: string; facts: DetailFact[] };
export type ResourceDetail = SessionRequest & {
  readId: number;
  reference: ResourceReference;
  item: ResourceItem;
  related: Record<string, ResourceReference>;
  sections?: DetailSection[];
};
const kinds = new Set<string>(["nodes", ...resourceViews.flatMap((v) => v.kind ? [v.kind] : [])]);
function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function closed(v: Record<string, unknown>, keys: string[]) { return Object.keys(v).every((k) => keys.includes(k)); }
function text(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && new TextEncoder().encode(v).length <= max && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(v);
}
function name(v: unknown, kind: string): v is string {
  if (["roles", "roleBindings", "clusterRoles", "clusterRoleBindings"].includes(kind)) {
    return typeof v === "string" && v.length > 0 && v.length <= 253 && v !== "." && v !== ".."
      && /^[A-Za-z0-9_.:-]+$/.test(v);
  }
  return typeof v === "string" && v.length <= 253 && v.split(".").every((s) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s));
}
function namespace(v: unknown): v is string {
  return typeof v === "string" && v.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(v);
}
function reference(v: unknown): v is ResourceReference {
  if (!record(v) || !closed(v, ["kind", "namespace", "name", "uid"]) || typeof v.kind !== "string" || !kinds.has(v.kind) || !name(v.name, v.kind)
    || !validResourceIdentity(v.uid)) return false;
  const scoped = resourceViews.find((view) => view.kind === v.kind)?.namespaced === true;
  return scoped ? namespace(v.namespace) : v.namespace === null;
}
function validRequest(r: DetailRequest) {
  return record(r) && closed(r, ["clusterId", "sessionId", "readId", "reference"])
    && text(r.clusterId, 256) && r.clusterId.trim() === r.clusterId
    && text(r.sessionId, 256) && r.sessionId.trim() === r.sessionId
    && Number.isSafeInteger(r.readId) && r.readId > 0 && reference(r.reference);
}
const eventKinds: Partial<Record<ResourceKind, string>> = {
  nodes: "Node", namespaces: "Namespace", pods: "Pod", deployments: "Deployment", daemonSets: "DaemonSet",
  statefulSets: "StatefulSet", replicaSets: "ReplicaSet", replicationControllers: "ReplicationController",
  jobs: "Job", cronJobs: "CronJob", configMaps: "ConfigMap", secrets: "Secret", resourceQuotas: "ResourceQuota",
  limitRanges: "LimitRange", horizontalPodAutoscalers: "HorizontalPodAutoscaler", verticalPodAutoscalers: "VerticalPodAutoscaler",
  podDisruptionBudgets: "PodDisruptionBudget", priorityClasses: "PriorityClass", runtimeClasses: "RuntimeClass", leases: "Lease",
  services: "Service", endpoints: "Endpoints", ingresses: "Ingress", ingressClasses: "IngressClass", networkPolicies: "NetworkPolicy",
  endpointSlices: "EndpointSlice", mutatingWebhookConfigurations: "MutatingWebhookConfiguration",
  validatingWebhookConfigurations: "ValidatingWebhookConfiguration", validatingAdmissionPolicies: "ValidatingAdmissionPolicy",
  validatingAdmissionPolicyBindings: "ValidatingAdmissionPolicyBinding", podSecurityPolicies: "PodSecurityPolicy",
  persistentVolumes: "PersistentVolume", persistentVolumeClaims: "PersistentVolumeClaim", storageClasses: "StorageClass",
  events: "Event", serviceAccounts: "ServiceAccount", roles: "Role", roleBindings: "RoleBinding", clusterRoles: "ClusterRole",
  clusterRoleBindings: "ClusterRoleBinding", customResourceDefinitions: "CustomResourceDefinition",
};
const workloads: readonly ResourceKind[] = ["pods", "deployments", "daemonSets", "statefulSets", "replicaSets", "replicationControllers", "jobs", "cronJobs"];
const relatedKinds: Record<string, readonly ResourceKind[]> = {
  namespace: ["namespaces"], node: ["nodes"], storageClass: ["storageClasses"], volume: ["persistentVolumes"],
  claim: ["persistentVolumeClaims"], roleRef: ["roles", "clusterRoles"], policy: ["validatingAdmissionPolicies"],
  target: ["deployments", "daemonSets", "statefulSets", "replicaSets", "replicationControllers"],
  controlledBy: ["deployments", "cronJobs", "replicaSets", "replicationControllers", "daemonSets", "statefulSets", "jobs"],
  serviceAccount: ["serviceAccounts"], class: ["ingressClasses"], involvedObject: Object.keys(eventKinds) as ResourceKind[],
};
function allowedColumn(kind: ResourceKind, column: string) {
  if (column === "namespace") return true;
  if (column === "controlledBy") return workloads.includes(kind);
  if (kind === "pods") return column === "node" || column === "serviceAccount";
  if (kind === "ingresses") return column === "class";
  if (kind === "events") return column === "involvedObject";
  if (kind === "persistentVolumes") return column === "storageClass" || column === "claim";
  if (kind === "persistentVolumeClaims") return column === "storageClass" || column === "volume";
  if (kind === "roleBindings" || kind === "clusterRoleBindings") return column === "roleRef";
  if (kind === "validatingAdmissionPolicyBindings") return column === "policy";
  return (kind === "horizontalPodAutoscalers" || kind === "verticalPodAutoscalers") && column === "target";
}
export function parseResourceDetail(value: unknown, request: DetailRequest): ResourceDetail {
  if (!record(value) || !closed(value, ["clusterId", "sessionId", "readId", "reference", "item", "related", "sections"])
    || value.clusterId !== request.clusterId || value.sessionId !== request.sessionId || value.readId !== request.readId
    || !reference(value.reference) || value.reference.kind !== request.reference.kind || value.reference.name !== request.reference.name
    || value.reference.namespace !== request.reference.namespace || typeof value.reference.uid !== "string"
    || (request.reference.uid != null && value.reference.uid !== request.reference.uid)
    || !record(value.item) || !record(value.related) || Object.keys(value.related).length > 12) throw "invalidResponse";
  const item = value.item;
  if (!closed(item, ["name", "uid", "resourceVersion", "namespace", "createdAt", "status", "columns", "node"])
    || item.name !== value.reference.name || item.namespace !== value.reference.namespace || item.uid !== value.reference.uid
    || !validResourceIdentity(item.resourceVersion) || !text(item.status, 256)
    || !(item.createdAt === null || validTimestamp(item.createdAt))
    || !record(item.columns) || Object.keys(item.columns).length > 12
    || !Object.entries(item.columns).every(([k, v]) => text(k, 128) && typeof v === "string" && v.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(v))) throw "invalidResponse";
  if ((request.reference.kind === "secrets" || request.reference.kind === "configMaps")
    && Object.keys(item.columns).length !== 0) throw "invalidResponse";
  const node = parseNode(item.node);
  if ((request.reference.kind === "nodes" && !node) || (request.reference.kind !== "nodes" && item.node !== null)) throw "invalidResponse";
  const related: Record<string, ResourceReference> = {};
  for (const [column, ref] of Object.entries(value.related)) {
    if (!Object.prototype.hasOwnProperty.call(relatedKinds, column) || !allowedColumn(request.reference.kind, column) || !reference(ref)
      || !relatedKinds[column].includes(ref.kind)
      || (column === "involvedObject" ? item.columns[column] !== `${eventKinds[ref.kind]}/${ref.name}`
        : column !== "namespace" && item.columns[column] !== undefined && item.columns[column] !== ref.name)
      || (column === "involvedObject" && (typeof ref.uid !== "string"
        || ref.namespace !== null && ref.namespace !== item.namespace))
      || (column === "serviceAccount" && (ref.namespace !== item.namespace || ref.uid != null))
      || (column === "namespace" && (ref.name !== item.namespace || ref.uid != null))
      || (column === "controlledBy" && (ref.namespace !== item.namespace || typeof ref.uid !== "string"))
      || (column === "target" && ref.namespace !== item.namespace)
      || (column === "roleRef" && (request.reference.kind === "clusterRoleBindings" && ref.kind !== "clusterRoles"
        || ref.kind === "roles" && ref.namespace !== item.namespace))) throw "invalidResponse";
    related[column] = { kind: ref.kind, namespace: ref.namespace, name: ref.name, uid: ref.uid ?? null };
  }
  let sections: DetailSection[] | undefined;
  if (value.sections !== undefined) {
    if (!Array.isArray(value.sections) || value.sections.length > 12) throw "invalidResponse";
    if ((request.reference.kind === "secrets" || request.reference.kind === "configMaps") && value.sections.length !== 0) throw "invalidResponse";
    if (new TextEncoder().encode(JSON.stringify(value.sections)).length > 64 * 1024) throw "invalidResponse";
    sections = value.sections.map((s) => {
      if (!record(s) || !closed(s, ["title", "facts"]) || !text(s.title, 128) || !Array.isArray(s.facts) || s.facts.length > 32
        || !s.facts.every((f) => record(f) && closed(f, ["label", "value"]) && text(f.label, 128) && text(f.value, 1024))) throw "invalidResponse";
      return { title: s.title, facts: s.facts.map((f) => ({ label: f.label, value: f.value })) };
    });
  }
  return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
    reference: { ...value.reference }, item: { name: item.name as string, namespace: item.namespace as string | null,
      uid: item.uid as string, resourceVersion: item.resourceVersion as string | null, createdAt: item.createdAt as string | null,
      status: item.status, columns: { ...item.columns } as Record<string, string>, node }, related, sections };
}
async function command(commandName: string, request: DetailRequest): Promise<unknown> {
  if (!validRequest(request)) throw "invalidInput";
  if (!isTauri()) throw "connectionFailed";
  try { return await invoke<unknown>(commandName, { request }); }
  catch (reason) { throw errorCode(reason); }
}
export async function loadResourceDetail(request: DetailRequest): Promise<ResourceDetail> {
  const snapshot = { ...request, reference: { ...request.reference } };
  return parseResourceDetail(await command("cluster_resource_detail", snapshot), snapshot);
}
export async function cancelResourceDetail(request: DetailRequest): Promise<void> {
  const result = await command("cluster_resource_detail_cancel", request);
  if (result !== null && result !== undefined) throw "invalidResponse";
}
