import type { Page } from "@playwright/test";

/** Install the browser-side model for the Rust-owned namespace snapshot IPC. */
export async function installNamespaceSnapshotMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tauri = window as typeof window & {
      __TAURI_INTERNALS__?: { invoke?: (command: string, args?: unknown) => Promise<unknown> };
      __namespaceSnapshotMockInstalled?: boolean;
    };
    if (tauri.__namespaceSnapshotMockInstalled) return;
    const internals = tauri.__TAURI_INTERNALS__;
    const original = internals?.invoke?.bind(internals);
    if (!internals || typeof original !== "function") return;
    tauri.__namespaceSnapshotMockInstalled = true;
    internals.invoke = async (command: string, args?: unknown) => {
      if (command === "cluster_namespace_cache_get") return null;
      if (command !== "cluster_namespace_cache_refresh") return original(command, args);

      const request = ((args as { request?: Record<string, unknown> } | undefined)?.request ?? {}) as Record<string, unknown>;
      const readId = request.readId;
      if (typeof request.clusterId !== "string" || typeof request.sessionId !== "string"
        || !Number.isSafeInteger(readId) || Number(readId) <= 0) throw "invalidInput";
      const names = new Set<string>();
      const tokens = new Set<string>();
      let continueToken: string | null = null;
      let partial = false;
      for (let page = 0; page < 10; page += 1) {
        const response = await original("cluster_resources", { request: {
          clusterId: request.clusterId, sessionId: request.sessionId, kind: "namespaces", readId, continueToken,
        } });
        if (typeof response !== "object" || response === null || Array.isArray(response)) throw "invalidResponse";
        const value = response as { items?: unknown; continueToken?: unknown; truncated?: unknown };
        if (!Array.isArray(value.items)) throw "invalidResponse";
        for (const item of value.items) {
          const name = typeof item === "object" && item !== null ? (item as { name?: unknown }).name : undefined;
          if (typeof name !== "string" || name.length > 63 || !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(name) || names.has(name)) throw "invalidResponse";
          names.add(name);
        }
        if (names.size > 1000) throw "limitExceeded";
        const token = value.continueToken;
        if (token !== null && token !== undefined && typeof token !== "string") throw "invalidResponse";
        partial = value.truncated === true || typeof token === "string";
        if (typeof token !== "string") break;
        if (tokens.has(token)) throw "invalidResponse";
        tokens.add(token);
        continueToken = token;
        if (page === 9) break;
      }
      const fetchedAt = Date.now();
      return { clusterId: request.clusterId, sessionId: request.sessionId, names: [...names], fetchedAt, expiresAt: fetchedAt + 24 * 60 * 60 * 1000, partial };
    };
  });
}
