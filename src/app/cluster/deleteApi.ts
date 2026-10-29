import { invoke, hasEngine as isTauri } from "../engine";
import { connectionMessage, errorCode, validResourceIdentity, type ResourceItem, type ResourceKind, type SessionRequest } from "./api";
import { creationNamespaced } from "./createApi";
import { resourceCreation } from "./resourceViews";

export type DeleteTarget = Pick<ResourceItem, "name" | "namespace"> & { uid: string; resourceVersion: string };
export type DeleteCancelRequest = SessionRequest & { kind: ResourceKind; readId: number };
export type DeleteRequest = DeleteCancelRequest & DeleteTarget;
export type DeleteResult = SessionRequest & DeleteTarget & { kind: ResourceKind; deleted: boolean; accepted: boolean };
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const resourceRowKey = (item: ResourceItem) => JSON.stringify([item.namespace, item.name, item.uid ?? null]);
export function hasDeleteIdentity(item: ResourceItem): item is ResourceItem & DeleteTarget {
  return typeof item.uid === "string" && typeof item.resourceVersion === "string"
    && validResourceIdentity(item.uid) && validResourceIdentity(item.resourceVersion);
}
function validScope(request: DeleteCancelRequest) {
  return !!request.clusterId && !!request.sessionId && Object.prototype.hasOwnProperty.call(resourceCreation, request.kind)
    && Number.isSafeInteger(request.readId) && request.readId > 0;
}
export async function deleteResource(request: DeleteRequest): Promise<DeleteResult> {
  if (!validScope(request) || !hasDeleteIdentity({ ...request, status: "", createdAt: null, columns: {}, node: null })
    || request.name.length > 253 || !request.name.split(".").every(part => dnsLabel.test(part))
    || (creationNamespaced(request.kind) ? typeof request.namespace !== "string" || !dnsLabel.test(request.namespace) : request.namespace !== null)) throw "invalidInput";
  if (!isTauri()) throw "connectionFailed";
  const value = await invoke<unknown>("cluster_resource_delete", { request });
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw "invalidResponse";
  const result = value as Record<string, unknown>;
  if (["clusterId", "sessionId", "kind", "name", "namespace", "uid", "resourceVersion"].some(key => result[key] !== request[key as keyof DeleteRequest])
    || typeof result.deleted !== "boolean" || typeof result.accepted !== "boolean" || result.deleted === result.accepted) throw "invalidResponse";
  return { clusterId: request.clusterId, sessionId: request.sessionId, kind: request.kind, name: request.name,
    namespace: request.namespace, uid: request.uid, resourceVersion: request.resourceVersion, deleted: result.deleted, accepted: result.accepted };
}
export async function cancelResourceDelete(request: DeleteCancelRequest): Promise<void> {
  if (!validScope(request)) throw "invalidInput";
  if (!isTauri()) return;
  const result = await invoke("cluster_resource_delete_cancel", { request: {
    clusterId: request.clusterId, sessionId: request.sessionId, kind: request.kind, readId: request.readId,
  } });
  if (result !== null && result !== undefined) throw "invalidResponse";
}
export function deleteMessage(reason: unknown) {
  switch (reason) {
    case "notFound": return "Not found. Refresh to check whether this resource was already removed.";
    case "conflict": return "Resource changed or was replaced. Refresh and select it again before deleting.";
    case "permissionDenied": return "Deletion denied. Check this context's Kubernetes RBAC get and delete permissions.";
    case "invalidInput": return "Deletion requires a valid resource name, namespace, UID and resource version.";
    default: return connectionMessage(errorCode(reason));
  }
}
