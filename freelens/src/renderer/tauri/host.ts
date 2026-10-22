/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { type RequestFromChannel, requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import {
  catalogSnapshotChannel,
  parseCatalogSnapshot,
  parseRuntimeStatus,
  runtimeStatusChannel,
} from "../../common/tauri/protocol";

import type { RuntimeHost } from "./app";

export type RuntimeInvoke = (command: string) => Promise<unknown>;

interface TauriWindow extends Window {
  __TAURI__?: { core: { invoke: RuntimeInvoke } };
}

const invoke: RuntimeInvoke = (command) => {
  const api = (window as TauriWindow).__TAURI__;
  return api ? api.core.invoke(command) : Promise.reject(new Error("Tauri host is unavailable"));
};

export function createTauriRequester(invokeCommand: RuntimeInvoke): RequestFromChannel {
  // The generic channel API is narrowed here, before anything crosses the host boundary.
  return (async (channel: { id: string }, request?: unknown) => {
    if (request !== undefined) throw new Error("Runtime read-only channels do not accept a payload");
    switch (channel.id) {
      case runtimeStatusChannel.id:
        return parseRuntimeStatus(await invokeCommand("runtime_status"));
      case catalogSnapshotChannel.id:
        return parseCatalogSnapshot(await invokeCommand("catalog_snapshot"));
      default:
        throw new Error(`Unsupported Tauri request channel: ${channel.id}`);
    }
  }) as RequestFromChannel;
}

// Registered explicitly by Tauri composition, never by Electron's generated root.
export const tauriRequester = getInjectable({
  id: "tauri-request-from-channel",
  injectionToken: requestFromChannelInjectionToken,
  instantiate: () => createTauriRequester(invoke),
});

export function createRuntimeHost(request: RequestFromChannel): RuntimeHost {
  return {
    status: () => request(runtimeStatusChannel),
    catalogSnapshot: () => request(catalogSnapshotChannel),
    ready: async () => {
      await invoke("runtime_ready");
    },
  };
}
