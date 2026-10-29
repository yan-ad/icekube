import { invoke, hasEngine } from "../engine";
import { clusterDestinations, type ClusterSectionId } from "../cluster/navigation";

export type ClusterConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export type ClusterSummary = {
  id: string;
  name: string;
  contextName: string;
  source: string;
  status: ClusterConnectionStatus;
  pinned: boolean;
  pinnedSections: ClusterSectionId[];
  labels: string[];
  color: string;
};
export type WebLinkSummary = { id: string; name: string; url: string; source: string; labels: string[]; color: string; pinned: boolean };
export type PinTarget = { id: string; section: ClusterSectionId | null };
export const pinKey = (target: PinTarget) => JSON.stringify([target.id, target.section]);
export type CatalogSnapshot = { revision: number; clusters: ClusterSummary[]; webLinks: WebLinkSummary[]; pinnedItems: PinTarget[]; discoveryError: string | null };
export type CatalogCommand = "catalog_list" | "catalog_import_kubeconfig" | "catalog_add_web_link" | "catalog_set_pin" | "catalog_set_section_pin" | "catalog_reorder_pins" | "catalog_remove";

const messages: Record<string, string> = {
  invalidInput: "Check the name and URL. Use an HTTP(S) URL without credentials, query parameters, or fragments, or an absolute kubeconfig path.",
  invalidKubeconfig: "This file is not a valid kubeconfig with named contexts and cluster references.",
  inputUnavailable: "The kubeconfig cannot be read. Check that the file or symbolic-link target exists, is accessible, and is a regular file. Broken or cyclic links are not supported.",
  limitExceeded: "The catalog or file exceeds its size limit. Kubeconfig imports are limited to 1 MiB and the catalog to 1,000 items.",
  duplicate: "That web link is already in the catalog.",
  notFound: "This item no longer exists. Refresh the catalog and try again.",
  storeUnavailable: "The catalog could not be read or saved. Check access to the app's data directory and try again.",
  storeCorrupt: "The saved catalog is invalid or uses an unsupported version. It has not been overwritten.",
  unavailable: "The Rust catalog engine is available in the desktop app only. Browser preview does not read local files or save catalog records.",
  invalidResponse: "The catalog engine returned an unsupported response. Refresh or restart the app.",
  openFailed: "The web link could not be opened in your default browser. Check your operating system's default browser setting and try again.",
};

export function catalogError(error: unknown): string {
  return typeof error === "string" && Object.prototype.hasOwnProperty.call(messages, error)
    ? messages[error]
    : "The catalog operation failed. Try again; no success has been assumed.";
}
function connectionStatus(value: unknown): value is ClusterConnectionStatus {
  return typeof value === "string" && ["disconnected", "connecting", "connected", "error"].includes(value);
}
export async function loadCatalogConnectionStates(): Promise<{ clusterId: string; status: ClusterConnectionStatus }[]> {
  if (!hasCatalogEngine()) throw "unavailable";
  const result: unknown = await invoke("catalog_connection_states");
  if (!Array.isArray(result) || result.length > 1 || !result.every(item => record(item)
    && Object.keys(item).every(key => ["clusterId", "status"].includes(key))
    && typeof item.clusterId === "string" && item.clusterId.length > 0 && item.clusterId.length <= 256
    && !/[\u0000-\u001f\u007f-\u009f]/.test(item.clusterId) && connectionStatus(item.status))) throw "invalidResponse";
  return result;
}

export async function openSavedWebLink(id: string): Promise<void> {
  if (!hasCatalogEngine()) throw "unavailable";
  await invoke<void>("catalog_open_web_link", { request: { id } });
}

export function hasCatalogEngine() { return hasEngine(); }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function summary(value: unknown): value is Record<string, unknown> & { id: string; name: string; pinned: boolean } {
  return record(value) && typeof value.id === "string" && typeof value.name === "string"
    && typeof value.pinned === "boolean" && typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color)
    && typeof value.source === "string" && Array.isArray(value.labels)
    && value.labels.length <= 10 && value.labels.every((label) => typeof label === "string" && label.length <= 4101);
}
function parseSnapshot(value: unknown): CatalogSnapshot {
  if (!record(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !(value.discoveryError === null || typeof value.discoveryError === "string")
    || !Array.isArray(value.clusters) || !Array.isArray(value.webLinks)
    || value.clusters.length + value.webLinks.length > 1000
    || !value.clusters.every((item) => summary(item) && record(item)
      && typeof item.contextName === "string" && typeof item.source === "string" && connectionStatus(item.status)
      && (item.pinnedSections === undefined || (Array.isArray(item.pinnedSections)
        && item.pinnedSections.length <= clusterDestinations.length
        && new Set(item.pinnedSections).size === item.pinnedSections.length
        && item.pinnedSections.every(section => clusterDestinations.some(destination => destination.id === section)))))
    || !value.webLinks.every((item) => summary(item) && typeof item.url === "string")
    || new Set([...value.clusters, ...value.webLinks].map((item) => item.id)).size !== value.clusters.length + value.webLinks.length) throw "invalidResponse";
  const clusters = value.clusters.map(item => ({ ...item,
    pinned: item.pinned || (item.pinnedSections as string[] | undefined)?.includes("overview") === true,
    pinnedSections: ((item.pinnedSections ?? []) as string[]).filter(section => section !== "overview"),
  })) as ClusterSummary[];
  const webLinks = value.webLinks as WebLinkSummary[];
  const expected: PinTarget[] = [
    ...clusters.filter(item => item.pinned).map(item => ({ id: item.id, section: null })),
    ...webLinks.filter(item => item.pinned).map(item => ({ id: item.id, section: null })),
    ...clusters.flatMap(item => clusterDestinations.filter(destination => item.pinnedSections.includes(destination.id))
      .map(destination => ({ id: item.id, section: destination.id }))),
  ];
  const expectedKeys = new Set(expected.map(pinKey));
  let pinnedItems = expected;
  if (value.pinnedItems !== undefined) {
    if (!Array.isArray(value.pinnedItems) || value.pinnedItems.length !== expected.length
      || !value.pinnedItems.every(item => record(item) && typeof item.id === "string"
        && Object.keys(item).every(key => key === "id" || key === "section")
        && (item.section === null || typeof item.section === "string") && expectedKeys.has(pinKey(item as PinTarget)))
      || new Set(value.pinnedItems.map(item => pinKey(item as PinTarget))).size !== expected.length) throw "invalidResponse";
    pinnedItems = value.pinnedItems as PinTarget[];
  }
  return { ...value, clusters, webLinks, pinnedItems } as CatalogSnapshot;
}

export async function catalogRequest(command: CatalogCommand, request?: Record<string, unknown>): Promise<CatalogSnapshot> {
  if (!hasCatalogEngine()) throw "unavailable";
  return parseSnapshot(await invoke<unknown>(command, request ? { request } : undefined));
}
