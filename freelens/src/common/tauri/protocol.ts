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
  protocolVersion: 1;
  scope: "built-in";
  categories: { id: string; name: string; kind: string; group: string; icon: string }[];
  entities: {
    id: string;
    name: string;
    kind: string;
    group: string;
    source: string;
    labels: Record<string, string>;
    status: string;
  }[];
}

export const maxCatalogCategories = 32;
export const maxCatalogEntities = 100;
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
    throw new Error("Invalid runtime response fields");
  }
  return value as Record<string, unknown>;
}

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

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
    !text(data.nodeVersion) ||
    !Number.isSafeInteger(data.processId) ||
    (data.processId as number) <= 0 ||
    !text(data.userData) ||
    data.sessionData !== data.userData ||
    !Array.isArray(data.phases) ||
    JSON.stringify(data.phases) !==
      JSON.stringify(["before-anything", "before-host-ready", "host-ready", "application-started"])
  ) {
    throw new Error("Invalid runtime status");
  }
  return data as unknown as RuntimeStatus;
}

export function parseCatalogSnapshot(value: unknown): CatalogSnapshot {
  const data = record(value, ["protocolVersion", "scope", "categories", "entities"]);
  if (
    data.protocolVersion !== 1 ||
    data.scope !== "built-in" ||
    !Array.isArray(data.categories) ||
    !Array.isArray(data.entities) ||
    data.categories.length > maxCatalogCategories ||
    data.entities.length > maxCatalogEntities
  ) {
    throw new Error("Invalid catalog snapshot");
  }
  const categories = new Set<string>();
  for (const item of data.categories) {
    const category = record(item, ["id", "name", "kind", "group", "icon"]);
    if (
      ![category.id, category.name, category.kind, category.group].every(text) ||
      typeof category.icon !== "string" ||
      category.id !== `${category.group}/${category.kind}` ||
      categories.has(category.id as string)
    ) {
      throw new Error("Invalid catalog category");
    }
    categories.add(category.id as string);
  }
  const entities = new Set<string>();
  for (const item of data.entities) {
    const entity = record(item, ["id", "name", "kind", "group", "source", "labels", "status"]);
    if (
      ![entity.id, entity.name, entity.kind, entity.group, entity.status].every(text) ||
      typeof entity.source !== "string" ||
      !categories.has(`${entity.group}/${entity.kind}`) ||
      entities.has(entity.id as string) ||
      typeof entity.labels !== "object" ||
      entity.labels === null ||
      Array.isArray(entity.labels) ||
      !Object.values(entity.labels).every((label) => typeof label === "string")
    ) {
      throw new Error("Invalid catalog entity");
    }
    entities.add(entity.id as string);
  }
  return data as unknown as CatalogSnapshot;
}
