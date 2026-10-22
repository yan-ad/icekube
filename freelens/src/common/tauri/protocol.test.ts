/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { type CatalogSnapshot, parseCatalogSnapshot, parseRuntimeStatus } from "./protocol";

const snapshot: CatalogSnapshot = {
  protocolVersion: 1,
  scope: "built-in",
  categories: [{ id: "example/General", group: "example", kind: "General", name: "General", icon: "settings" }],
  entities: [
    { id: "welcome", name: "Welcome", group: "example", kind: "General", source: "app", status: "active", labels: {} },
  ],
};

describe("runtime wire contracts", () => {
  it("accepts bounded snapshots and genuine empty catalogs", () => {
    expect(parseCatalogSnapshot(snapshot)).toEqual(snapshot);
    expect(parseCatalogSnapshot({ ...snapshot, categories: [], entities: [] }).entities).toEqual([]);
  });

  it.each([
    null,
    { ...snapshot, protocolVersion: 2 },
    { ...snapshot, scope: "clusters" },
    { ...snapshot, unknown: true },
    { ...snapshot, categories: Array(33).fill(snapshot.categories[0]) },
    { ...snapshot, entities: Array(101).fill(snapshot.entities[0]) },
    { ...snapshot, entities: [snapshot.entities[0], snapshot.entities[0]] },
    { ...snapshot, categories: [{ ...snapshot.categories[0], id: "wrong" }] },
    { ...snapshot, entities: [{ ...snapshot.entities[0], kind: "Missing" }] },
    { ...snapshot, entities: [{ ...snapshot.entities[0], labels: { invalid: 42 } }] },
    { ...snapshot, entities: [{ ...snapshot.entities[0], status: "" }] },
    { ...snapshot, entities: [{ ...snapshot.entities[0], spec: { path: "/execute" } }] },
  ])("rejects malformed snapshots: %j", (value) => {
    expect(() => parseCatalogSnapshot(value)).toThrow();
  });

  it("validates status rather than trusting an invoke generic", () => {
    const status = {
      protocolVersion: 1,
      runtime: "node",
      nodeVersion: "24",
      processId: 42,
      userData: "/isolated/Freelens",
      sessionData: "/isolated/Freelens",
      phases: ["before-anything", "before-host-ready", "host-ready", "application-started"],
    };
    expect(parseRuntimeStatus(status)).toEqual(status);
    expect(() => parseRuntimeStatus({ ...status, phases: [] })).toThrow();
    expect(() => parseRuntimeStatus({ ...status, processId: 0 })).toThrow();
    expect(() => parseRuntimeStatus({ ...status, unknown: true })).toThrow();
  });
});
