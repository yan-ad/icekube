/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { type PodsSnapshot, parsePodsRequest, parsePodsSnapshot } from "./pods-protocol";

const request = { clusterId: "0123456789abcdef0123456789abcdef", namespace: "default" };
const snapshot = (): PodsSnapshot => ({
  protocolVersion: 1,
  ...request,
  pods: [
    {
      uid: "uid",
      name: "pod",
      namespace: "default",
      nodeName: null,
      createdAt: null,
      phase: "Running",
      status: "Running",
      readyContainers: 1,
      totalContainers: 1,
      restartCount: 0,
      containers: [{ name: "app", ready: true, state: "running", init: false }],
      owner: { kind: "ReplicaSet", name: "owner" },
      cpu: null,
      memory: null,
    },
  ],
  namespaces: ["default"],
  truncated: false,
  warnings: [],
  error: null,
});
describe("Pods wire protocol", () => {
  it("accepts exact bounded requests and snapshots", () => {
    expect(parsePodsRequest(request)).toEqual(request);
    expect(parsePodsSnapshot(snapshot(), request)).toEqual(snapshot());
    expect(parsePodsRequest({ ...request, namespace: null }).namespace).toBeNull();
  });
  it.each([
    null,
    {},
    { ...request, url: "https://example.com" },
    { ...request, clusterId: "test-cluster" },
    { ...request, clusterId: "A".repeat(32) },
    { ...request, namespace: "../default" },
    { ...request, namespace: "" },
    { ...request, namespace: "a".repeat(64) },
    { ...request, namespace: 1 },
  ])("rejects invalid requests before use: %j", (value) => {
    expect(() => parsePodsRequest(value)).toThrow();
  });
  it("rejects unknown keys at every nested level", () => {
    for (const level of ["root", "pod", "container", "owner"]) {
      const s = snapshot();
      const target =
        level === "root"
          ? s
          : level === "pod"
            ? s.pods[0]
            : level === "container"
              ? s.pods[0].containers[0]
              : s.pods[0].owner;
      Object.assign(target!, { command: "execute" });
      expect(() => parsePodsSnapshot(s, request)).toThrow();
    }
  });
  it("rejects bounds, scopes, invalid metrics, raw diagnostics, and unknown enums", () => {
    const invalid: unknown[] = [
      { ...snapshot(), namespace: null },
      { ...snapshot(), clusterId: "f".repeat(32) },
      { ...snapshot(), error: "RAW_ERROR" },
      { ...snapshot(), warnings: ["secret-config-path"] },
      { ...snapshot(), warnings: Array(33).fill("Metrics unavailable") },
      { ...snapshot(), pods: Array(1001).fill(snapshot().pods[0]) },
      {
        ...snapshot(),
        pods: [{ ...snapshot().pods[0], containers: Array(257).fill(snapshot().pods[0].containers[0]) }],
      },
      { ...snapshot(), pods: [{ ...snapshot().pods[0], name: "x".repeat(4097) }] },
      { ...snapshot(), pods: [{ ...snapshot().pods[0], namespace: "other" }] },
      { ...snapshot(), pods: [{ ...snapshot().pods[0], cpu: Number.NaN }] },
      { ...snapshot(), pods: [{ ...snapshot().pods[0], restartCount: -1 }] },
      {
        ...snapshot(),
        pods: [{ ...snapshot().pods[0], containers: [{ ...snapshot().pods[0].containers[0], state: "exec" }] }],
      },
    ];
    for (const value of invalid) expect(() => parsePodsSnapshot(value, request)).toThrow();
  });
  it("bounds the serialized payload independently of per-field limits", () => {
    const pods = Array.from({ length: 300 }, (_, n) => ({
      ...snapshot().pods[0],
      uid: String(n),
      name: "x".repeat(4096),
    }));
    expect(() => parsePodsSnapshot({ ...snapshot(), pods }, request)).toThrow("limit");
  });
});
