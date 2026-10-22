/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
import { getRequestChannel } from "@freelensapp/messaging";

export interface RuntimeStatus {
  protocolVersion: 1;
  runtime: "node";
  nodeVersion: string;
  processId: number;
  userData: string;
  sessionData: string;
  phases: string[];
}

export interface CatalogSnapshot {
  protocolVersion: 2;
  scope: "local";
  categories: { id: string; name: string; kind: string; group: string; icon: string }[];
  entities: {
    id: string;
    name: string;
    kind: string;
    group: string;
    source: string;
    status: string;
    labels: Record<string, string>;
    icon: { material: string; background: string } | null;
    action: "welcome" | "catalog" | null;
  }[];
  warnings: string[];
}

export const maxCatalogCategories = 32;
export const maxCatalogEntities = 1000;
export const maxCatalogWarnings = 256;
export const runtimeStatusChannel = getRequestChannel<void, RuntimeStatus>("runtime.status");
export const catalogSnapshotChannel = getRequestChannel<void, CatalogSnapshot>("catalog.snapshot");

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error("Invalid response fields");
  }
  return value as Record<string, unknown>;
}
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096;
const labels = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length <= 256 &&
  Object.entries(value).every(
    ([key, item]) => key.length > 0 && key.length <= 256 && typeof item === "string" && item.length <= 4096,
  );

export function parseRuntimeStatus(value: unknown): RuntimeStatus {
  const data = record(value, [
    "protocolVersion",
    "runtime",
    "nodeVersion",
    "processId",
    "userData",
    "sessionData",
    "phases",
  ]);
  if (
    data.protocolVersion !== 1 ||
    data.runtime !== "node" ||
    !(typeof data.nodeVersion === "string" && data.nodeVersion.length > 0) ||
    !Number.isSafeInteger(data.processId) ||
    (data.processId as number) <= 0 ||
    !(typeof data.userData === "string" && data.userData.length > 0) ||
    data.sessionData !== data.userData ||
    !Array.isArray(data.phases) ||
    JSON.stringify(data.phases) !==
      JSON.stringify(["before-anything", "before-host-ready", "host-ready", "application-started"])
  )
    throw new Error("Invalid runtime status");
  return data as unknown as RuntimeStatus;
}

export function parseCatalogSnapshot(value: unknown): CatalogSnapshot {
  const data = record(value, ["protocolVersion", "scope", "categories", "entities", "warnings"]);
  if (
    data.protocolVersion !== 2 ||
    data.scope !== "local" ||
    !Array.isArray(data.categories) ||
    !Array.isArray(data.entities) ||
    !Array.isArray(data.warnings) ||
    data.categories.length > maxCatalogCategories ||
    data.entities.length > maxCatalogEntities ||
    data.warnings.length > maxCatalogWarnings ||
    !data.warnings.every(text)
  )
    throw new Error("Invalid catalog snapshot");
  const categoryIds = new Set<string>();
  for (const item of data.categories) {
    const c = record(item, ["id", "name", "kind", "group", "icon"]);
    if (
      ![c.id, c.name, c.kind, c.group, c.icon].every(text) ||
      !["settings", "kubernetes", "public"].includes(c.icon as string) ||
      c.id !== `${c.group}/${c.kind}` ||
      categoryIds.has(c.id as string)
    )
      throw new Error("Invalid catalog category");
    categoryIds.add(c.id as string);
  }
  const entityIds = new Set<string>();
  for (const item of data.entities) {
    const e = record(item, ["id", "name", "kind", "group", "source", "status", "labels", "icon", "action"]);
    if (
      ![e.id, e.name, e.kind, e.group, e.source, e.status].every(text) ||
      !categoryIds.has(`${e.group}/${e.kind}`) ||
      entityIds.has(e.id as string) ||
      !labels(e.labels) ||
      (e.action !== null && e.action !== "welcome" && e.action !== "catalog")
    )
      throw new Error("Invalid catalog entity");
    if (
      e.action !== null &&
      (e.group !== "entity.k8slens.dev" ||
        e.kind !== "General" ||
        e.source !== "app" ||
        e.id !== (e.action === "welcome" ? "welcome-page-entity" : "catalog-entity"))
    )
      throw new Error("Invalid catalog action relation");
    if (e.icon !== null) {
      const i = record(e.icon, ["material", "background"]);
      if (!text(i.material) || !text(i.background)) throw new Error("Invalid catalog icon");
    }
    entityIds.add(e.id as string);
  }
  return data as unknown as CatalogSnapshot;
}
