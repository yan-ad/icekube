/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";
import { describe, expect, it, vi } from "vitest";
import { catalogSnapshotChannel } from "../../common/tauri/protocol";
import { createTauriRequester } from "./host";

describe("Tauri request adapter", () => {
  it("maps only explicitly supported channels to native commands", async () => {
    const snapshot = { protocolVersion: 1, scope: "built-in", categories: [], entities: [] };
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
      .mockResolvedValue({ protocolVersion: 1, scope: "built-in", categories: [], entities: [], extra: true });
    await expect(createTauriRequester(invoke)(catalogSnapshotChannel)).rejects.toThrow();
  });
});
