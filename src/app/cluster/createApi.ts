import { invoke, isTauri } from "@tauri-apps/api/core";
import { connectionMessage, errorCode, type ResourceKind, type SessionRequest } from "./api";
import { resourceCreation, resourceViews } from "./resourceViews";

export type CreateCancelRequest = SessionRequest & { kind: ResourceKind; readId: number };
export type CreateRequest = CreateCancelRequest & { namespace?: string | null; yaml: string; dryRun: boolean };
export type CreateResult = SessionRequest & { kind: ResourceKind; namespace: string | null; name: string; created: boolean };
const namespacePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const namePattern = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
export function creationNamespaced(kind: ResourceKind) {
  return resourceViews.find(view => view.kind === kind)?.namespaced === true;
}
function validIdentity(request: CreateCancelRequest) {
  return !!request.clusterId && !!request.sessionId && Object.prototype.hasOwnProperty.call(resourceCreation, request.kind)
    && Number.isSafeInteger(request.readId) && request.readId > 0;
}
export async function createResource(request: CreateRequest): Promise<CreateResult> {
  if (!validIdentity(request) || !request.yaml.trim() || request.yaml.includes("\0")
    || new TextEncoder().encode(request.yaml).length > 256 * 1024
    || typeof request.dryRun !== "boolean"
    || request.namespace != null && (!creationNamespaced(request.kind) || !namespacePattern.test(request.namespace))) throw "invalidInput";
  if (!isTauri()) throw "connectionFailed";
  const value = await invoke<unknown>("cluster_resource_create", { request });
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw "invalidResponse";
  const result = value as Record<string, unknown>;
  if (result.clusterId !== request.clusterId || result.sessionId !== request.sessionId || result.kind !== request.kind
    || result.created !== !request.dryRun || typeof result.name !== "string" || !namePattern.test(result.name)
    || !result.name.split(".").every(part => namespacePattern.test(part))
    || (creationNamespaced(request.kind)
      ? typeof result.namespace !== "string" || !namespacePattern.test(result.namespace)
        || request.namespace != null && result.namespace !== request.namespace
      : result.namespace !== null)) throw "invalidResponse";
  return { clusterId: request.clusterId, sessionId: request.sessionId, kind: request.kind,
    namespace: result.namespace as string | null, name: result.name, created: result.created };
}
export async function cancelResourceCreate(request: CreateCancelRequest): Promise<void> {
  if (!validIdentity(request)) throw "invalidInput";
  if (!isTauri()) return;
  await invoke("cluster_resource_create_cancel", { request: {
    clusterId: request.clusterId, sessionId: request.sessionId, kind: request.kind, readId: request.readId,
  } });
}
export function createMessage(reason: unknown) {
  switch (reason) {
    case "invalidInput": return "The manifest was rejected. Supply one YAML document with the expected apiVersion, kind and metadata.name, remove server-managed fields and status, and check required fields and namespace. Maximum size: 256 KiB.";
    case "permissionDenied": return "Creation or server dry-run was denied. Check this context's Kubernetes RBAC create permissions for the selected kind and namespace.";
    case "resourceUnavailable": return "This resource API is not available on this cluster. Check that the API version is supported and any required CRD is installed.";
    case "conflict": return "A resource with this name already exists. Refresh the inventory and choose another name; creation does not overwrite existing resources.";
    default: return connectionMessage(errorCode(reason));
  }
}
