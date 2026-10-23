/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";
import { describe, expect, it, vi } from "vitest";
import { podsListChannel } from "../../common/tauri/pods-protocol";
import { catalogSnapshotChannel } from "../../common/tauri/protocol";
import { createTauriRequester } from "./host";

describe("Tauri request adapter", () => {
  it("maps only explicitly supported channels to native commands", async () => {
    const snapshot = { protocolVersion: 2, scope: "local", categories: [], entities: [], warnings: [] };
    const invoke = vi.fn().mockResolvedValue(snapshot);
    await expect(createTauriRequester(invoke)(catalogSnapshotChannel)).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledWith("catalog_snapshot");
  });

  it("rejects unknown channels and unexpected payloads before invoking the host", async () => {
    const invoke = vi.fn();
    const request = createTauriRequester(invoke);
    await expect(request(getRequestChannel<void, void>("execute"))).rejects.toThrow("Unsupported");
    await expect(request(getRequestChannel<object, void>(catalogSnapshotChannel.id), {})).rejects.toThrow("payload");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects malformed host results", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ protocolVersion: 2, scope: "untrusted", categories: [], entities: [], warnings: [] });
    await expect(createTauriRequester(invoke)(catalogSnapshotChannel)).rejects.toThrow();
  });
});

describe("Pods request adapter", () => {
  const dto = { clusterId: "0123456789abcdef0123456789abcdef", namespace: "default" };
  const snapshot = {
    protocolVersion: 1,
    ...dto,
    pods: [],
    namespaces: [],
    truncated: false,
    warnings: [],
    error: null,
  };
  it("uses only the typed native request object", async () => {
    const invoke = vi.fn().mockResolvedValue(snapshot);
    await expect(createTauriRequester(invoke)(podsListChannel, dto)).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledWith("pods_list", { request: dto });
  });
  it("rejects unknown request fields and invalid scopes before invoking", async () => {
    const invoke = vi.fn();
    const request = createTauriRequester(invoke);
    for (const value of [
      { ...dto, url: "https://example.com" },
      { ...dto, namespace: "../secret" },
      { ...dto, clusterId: "test" },
      undefined,
    ]) {
      await expect(request(getRequestChannel<unknown, unknown>(podsListChannel.id), value)).rejects.toThrow();
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects unknown host payloads and mismatched cluster/namespace", async () => {
    for (const value of [
      { ...snapshot, extra: true },
      { ...snapshot, clusterId: "f".repeat(32) },
      { ...snapshot, namespace: null },
      { ...snapshot, error: { message: "secret" } },
      null,
    ]) {
      await expect(createTauriRequester(vi.fn().mockResolvedValue(value))(podsListChannel, dto)).rejects.toThrow();
    }
  });
});
