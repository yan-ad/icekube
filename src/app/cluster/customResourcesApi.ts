import { invoke, hasEngine as isTauri } from "../engine";
import { errorCode, type SessionRequest } from "./api";
import { validTimestamp } from "./nodeContract";

export type CustomDefinition = { name: string; uid: string; group: string; plural: string; kind: string; scope: "Namespaced" | "Cluster"; version: string };
export type CustomRead = SessionRequest & { readId: number; continueToken?: string | null };
export type CustomInstanceRead = CustomRead & { definitionName: string; definitionUid: string; namespace: string | null };
export type CustomInstance = { name: string; uid: string; namespace: string | null; createdAt: string | null; labelCount: number };
export type CustomPage<T> = SessionRequest & { readId: number; items: T[]; continueToken: string | null; truncated: boolean; fetchedAt: number };
export type CustomInstancePage = CustomPage<CustomInstance> & {
  target: { definitionName: string; definitionUid: string }; group: string; version: string; plural: string; kind: string; namespaced: boolean; namespace: string | null;
};
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const closed = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).every(key => keys.includes(key));
const text = (v: unknown, max = 256): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(v);
const namespace = (v: unknown): v is string => typeof v === "string" && v.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(v);
export const validDefinitionName = (v: unknown): v is string => typeof v === "string" && v.length <= 253 && v.split(".").every(namespace);
const uid = (v: unknown): v is string => text(v) && /^[A-Za-z0-9-]+$/.test(v);
const version = (v: unknown): v is string => typeof v === "string" && v.length <= 63 && /^v[a-z0-9]*$/.test(v);
const kind = (v: unknown): v is string => typeof v === "string" && v.length <= 63 && /^[A-Za-z][A-Za-z0-9]*$/.test(v);
const token = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096 && /^[\x21-\x7e]+$/.test(v);
const readId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
function readScope(request: CustomRead): CustomRead {
  if (!text(request.clusterId) || request.clusterId.trim() !== request.clusterId
    || !text(request.sessionId) || request.sessionId.trim() !== request.sessionId || !readId(request.readId)
    || !(request.continueToken == null || token(request.continueToken))) throw "invalidInput";
  return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
    ...(request.continueToken === undefined ? {} : { continueToken: request.continueToken }) };
}
function instanceScope(request: CustomInstanceRead) {
  const scope = readScope(request);
  if (!validDefinitionName(request.definitionName) || !uid(request.definitionUid)
    || !(request.namespace === null || namespace(request.namespace))) throw "invalidInput";
  return { ...scope, target: { definitionName: request.definitionName, definitionUid: request.definitionUid }, namespace: request.namespace };
}
function pageScope(v: Record<string, unknown>, request: CustomRead) {
  return v.clusterId === request.clusterId && v.sessionId === request.sessionId && readId(v.readId) && v.readId === request.readId
    && Array.isArray(v.items) && v.items.length <= 100 && (v.continueToken === null || token(v.continueToken)) && typeof v.truncated === "boolean";
}
async function call(command: string, request: object): Promise<unknown> {
  if (!isTauri()) throw "notConnected";
  try { return await invoke(command, { request }); } catch (reason) { throw errorCode(reason); }
}
export function parseCustomDefinitions(value: unknown, request: CustomRead): CustomPage<CustomDefinition> {
  readScope(request);
  if (!record(value) || !closed(value, ["clusterId", "sessionId", "readId", "kind", "items", "namespace", "continueToken", "metrics", "truncated", "fetchedAt"])
    || !pageScope(value, request) || value.kind !== "customResourceDefinitions" || value.namespace !== null || value.metrics !== null
    || !Number.isSafeInteger(value.fetchedAt) || (value.fetchedAt as number) < 0 || (value.fetchedAt as number) > 8.64e15) throw "invalidResponse";
  const items = (value.items as unknown[]).map((item): CustomDefinition => {
    if (!record(item) || !closed(item, ["name", "uid", "resourceVersion", "namespace", "status", "createdAt", "columns", "node"])
      || !validDefinitionName(item.name) || !uid(item.uid) || item.namespace !== null || item.node !== null
      || !text(item.status) || !(item.resourceVersion == null || text(item.resourceVersion))
      || !(item.createdAt === null || validTimestamp(item.createdAt)) || !record(item.columns)
      || !closed(item.columns, ["group", "plural", "kind", "scope", "versions", "shortNames"])
      || !Object.values(item.columns).every(column => typeof column === "string" && column.length <= 256 && (column === "" || text(column)))) throw "invalidResponse";
    const columns = item.columns;
    // Discovery versions are display labels; Rust resolves the served endpoint from the UID-bound definition.
    const firstVersion = typeof columns.versions === "string" ? columns.versions.split(",")[0] : undefined;
    if (!validDefinitionName(columns.group) || !columns.group.includes(".") || !namespace(columns.plural) || !kind(columns.kind)
      || !version(firstVersion) || !(columns.scope === "Namespaced" || columns.scope === "Cluster")
      || item.name !== `${columns.plural}.${columns.group}`) throw "invalidResponse";
    return { name: item.name, uid: item.uid, group: columns.group, plural: columns.plural, kind: columns.kind, scope: columns.scope, version: firstVersion };
  });
  if (new Set(items.map(item => item.name)).size !== items.length || new Set(items.map(item => item.uid)).size !== items.length) throw "invalidResponse";
  return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, items,
    continueToken: value.continueToken as string | null, truncated: value.truncated as boolean, fetchedAt: value.fetchedAt as number };
}
export async function loadCustomDefinitions(request: CustomRead) {
  const scope = readScope(request);
  return parseCustomDefinitions(await call("cluster_custom_resource_definitions", scope), scope);
}
export function parseCustomInstances(raw: unknown, request: CustomInstanceRead): CustomInstancePage {
  instanceScope(request);
  if (!record(raw) || !closed(raw, ["clusterId", "sessionId", "readId", "target", "group", "version", "plural", "kind", "namespaced", "namespace", "items", "continueToken", "truncated"])
    || !pageScope(raw, request) || !record(raw.target) || !closed(raw.target, ["definitionName", "definitionUid"])
    || raw.target.definitionName !== request.definitionName || raw.target.definitionUid !== request.definitionUid || raw.namespace !== request.namespace
    || !validDefinitionName(raw.group) || !raw.group.includes(".") || !namespace(raw.plural) || `${raw.plural}.${raw.group}` !== request.definitionName
    || !version(raw.version) || !kind(raw.kind) || typeof raw.namespaced !== "boolean" || (!raw.namespaced && request.namespace !== null)) throw "invalidResponse";
  const items = (raw.items as unknown[]).map(item => {
    if (!record(item) || !closed(item, ["name", "uid", "namespace", "createdAt", "labelCount"])
      || !validDefinitionName(item.name) || !uid(item.uid)
      || !(raw.namespaced ? namespace(item.namespace) : item.namespace === null)
      || (request.namespace !== null && item.namespace !== request.namespace)
      || !(item.createdAt === null || validTimestamp(item.createdAt)) || !Number.isSafeInteger(item.labelCount) || (item.labelCount as number) < 0) throw "invalidResponse";
    return { name: item.name, uid: item.uid, namespace: item.namespace as string | null, createdAt: item.createdAt as string | null, labelCount: item.labelCount as number };
  });
  if (new Set(items.map(item => `${item.namespace ?? ""}/${item.name}`)).size !== items.length
    || new Set(items.map(item => item.uid)).size !== items.length) throw "invalidResponse";
  return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
    target: { definitionName: request.definitionName, definitionUid: request.definitionUid }, group: raw.group, version: raw.version,
    plural: raw.plural, kind: raw.kind, namespaced: raw.namespaced, namespace: request.namespace, items,
    continueToken: raw.continueToken as string | null, truncated: raw.truncated as boolean, fetchedAt: Date.now() };
}
export async function loadCustomInstances(request: CustomInstanceRead) {
  const scope = instanceScope(request);
  const expected = { ...readScope(request), ...scope.target, namespace: scope.namespace };
  return parseCustomInstances(await call("cluster_custom_resources", scope), expected);
}
export async function cancelCustomRead(request: CustomRead, definitions = false) {
  const scope = definitions ? readScope(request) : instanceScope(request as CustomInstanceRead);
  if (!isTauri()) return;
  const result = await call(definitions ? "cluster_custom_resource_definitions_cancel" : "cluster_custom_resources_cancel", scope);
  if (result !== undefined && result !== null) throw "invalidResponse";
}
