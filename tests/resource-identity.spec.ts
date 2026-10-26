import { expect, test } from "@playwright/test";

for (const source of ["list", "sync-open", "sync-read"] as const) {
  test(`${source} validates and retains bounded resource identity without object bodies`, async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (source) => {
      const apiPath = "/src/app/cluster/api.ts";
      const syncPath = "/src/app/cluster/podSyncApi.ts";
      const api = await import(/* @vite-ignore */ apiPath);
      const sync = await import(/* @vite-ignore */ syncPath);
      const request = { clusterId: "identity-fixture", sessionId: "lease", kind: "pods", readId: 37, namespace: "team", continueToken: null };
      const calls: { command: string; request: unknown }[] = [];
      let response: unknown;
      Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {
        invoke: async (command: string, args: { request: unknown }) => {
          calls.push({ command, request: args.request });
          return command === "cluster_pod_sync_close" ? null : response;
        },
      } });
      const load = async (fields: Record<string, unknown>) => {
        const item = { name: "example", status: "Running", namespace: "team", createdAt: null, columns: {}, node: null,
          metadata: { annotations: { password: "PRIVATE" } }, data: { password: "PRIVATE" }, spec: { password: "PRIVATE" }, ...fields };
        const page = { ...request, items: [item], truncated: false, fetchedAt: 1, metrics: null };
        response = source === "list" ? page : { clusterId: request.clusterId, sessionId: request.sessionId, syncId: "sync", sequence: 1, page, status: "syncing", error: null };
        try {
          const result = source === "list" ? await api.loadResources(request)
            : source === "sync-open" ? (await sync.openPodSync(request)).page
              : (await sync.readPodSync({ clusterId: request.clusterId, sessionId: request.sessionId, syncId: "sync", readId: request.readId }, request)).page;
          return { item: result.items[0], error: null };
        } catch (error) { return { item: null, error }; }
      };
      const safe = await load({ uid: "uid-123", resourceVersion: "v1:42" });
      const legacy = await load({});
      const nullable = await load({ uid: null, resourceVersion: null });
      const boundary = await load({ uid: "x".repeat(256), resourceVersion: "x".repeat(256) });
      const malformed = [];
      for (const field of ["uid", "resourceVersion"]) {
        for (const invalid of [42, false, [], { password: "PRIVATE" }, "", " ", "a b", "a\tb", "a\nb", "a\n", "a\0b", "a\x7fb", "a\u0085b", "a\u00a0b", "é", "x".repeat(257)]) {
          malformed.push(await load({ uid: "valid", resourceVersion: "valid", [field]: invalid }));
        }
      }
      return { safe, legacy, nullable, boundary, malformed, calls, request };
    }, source);
    expect(results.safe.item).toMatchObject({ uid: "uid-123", resourceVersion: "v1:42" });
    expect(JSON.stringify(results.safe)).not.toContain("PRIVATE");
    for (const key of ["metadata", "data", "spec"]) expect(results.safe.item).not.toHaveProperty(key);
    for (const result of [results.legacy, results.nullable]) {
      expect(result.item).toMatchObject({ uid: null, resourceVersion: null });
      expect(result.error).toBeNull();
    }
    expect(results.boundary.item).toMatchObject({ uid: "x".repeat(256), resourceVersion: "x".repeat(256) });
    for (const result of results.malformed) expect(result.error).toBe("invalidResponse");
    const command = source === "list" ? "cluster_resources" : source === "sync-open" ? "cluster_pod_sync_open" : "cluster_pod_sync_read";
    const expected = source === "sync-read" ? { clusterId: "identity-fixture", sessionId: "lease", syncId: "sync" } : results.request;
    for (const call of results.calls.filter(call => call.command === command)) expect(call.request).toEqual(expected);
  });
}
