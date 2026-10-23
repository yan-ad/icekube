import { invoke, isTauri } from "@tauri-apps/api/core";

export type ClusterSummary = {
  id: string;
  name: string;
  contextName: string;
  source: string;
  status: "disconnected";
  pinned: boolean;
};
export type WebLinkSummary = { id: string; name: string; url: string; pinned: boolean };
export type CatalogSnapshot = { revision: number; clusters: ClusterSummary[]; webLinks: WebLinkSummary[] };
export type CatalogCommand = "catalog_list" | "catalog_import_kubeconfig" | "catalog_add_web_link" | "catalog_set_pin" | "catalog_remove";

const messages: Record<string, string> = {
  invalidInput: "Check the name and URL. Use an HTTP(S) URL without credentials, query parameters, or fragments, or an absolute kubeconfig path.",
  invalidKubeconfig: "This file is not a valid kubeconfig with named contexts and cluster references.",
  inputUnavailable: "The selected file cannot be read. Use a regular file, not a symbolic link.",
  limitExceeded: "The catalog or file exceeds its size limit. Kubeconfig imports are limited to 1 MiB and the catalog to 1,000 items.",
  duplicate: "That web link is already in the catalog.",
  notFound: "This item no longer exists. Refresh the catalog and try again.",
  storeUnavailable: "The catalog could not be read or saved. Check access to the app's data directory and try again.",
  storeCorrupt: "The saved catalog is invalid or uses an unsupported version. It has not been overwritten.",
  unavailable: "The Rust catalog engine is available in the desktop app only. Browser preview does not read local files or save catalog records.",
  invalidResponse: "The catalog engine returned an unsupported response. Refresh or restart the app.",
};

export function catalogError(error: unknown): string {
  return typeof error === "string" && Object.prototype.hasOwnProperty.call(messages, error)
    ? messages[error]
    : "The catalog operation failed. Try again; no success has been assumed.";
}

export function hasCatalogEngine() { return isTauri(); }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function summary(value: unknown): value is Record<string, unknown> & { id: string; name: string; pinned: boolean } {
  return record(value) && typeof value.id === "string" && typeof value.name === "string"
    && typeof value.pinned === "boolean";
}
function parseSnapshot(value: unknown): CatalogSnapshot {
  if (!record(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !Array.isArray(value.clusters) || !Array.isArray(value.webLinks)
    || value.clusters.length + value.webLinks.length > 1000
    || !value.clusters.every((item) => summary(item) && record(item)
      && typeof item.contextName === "string" && typeof item.source === "string" && item.status === "disconnected")
    || !value.webLinks.every((item) => summary(item) && typeof item.url === "string")) throw "invalidResponse";
  return value as CatalogSnapshot;
}

export async function catalogRequest(command: CatalogCommand, request?: Record<string, unknown>): Promise<CatalogSnapshot> {
  if (!hasCatalogEngine()) throw "unavailable";
  return parseSnapshot(await invoke<unknown>(command, request ? { request } : undefined));
}
