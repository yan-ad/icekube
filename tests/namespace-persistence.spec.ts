import { expect, test } from "@playwright/test";

test("cache hydration is effect-owned, stale-safe and never grants unknown access", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite source fixture.
    const { createNamespaceStore } = await import("/src/app/cluster/namespaceStore.ts");
    type Snapshot = import("../src/app/cluster/namespaceCacheApi").NamespaceSnapshot;
    const scope = { clusterId: "fixture", sessionId: "lease" };
    const snapshot = (names: string[]): Snapshot => ({ ...scope, names, fetchedAt: 1, expiresAt: 2, partial: true });
    let cacheReads = 0;
    const cacheWaiters: ((value: Snapshot | null) => void)[] = [];
    const liveWaiters: { resolve: (value: Snapshot) => void; reject: (error: string) => void }[] = [];
    const cancelled: unknown[] = [];
    const owner = createNamespaceStore(scope, {
      loadCache: () => { cacheReads++; return new Promise<Snapshot | null>(resolve => cacheWaiters.push(resolve)); },
      refreshSnapshot: () => new Promise<Snapshot>((resolve, reject) => liveWaiters.push({ resolve, reject })),
      cancel: async request => { cancelled.push(request); },
    });
    const constructed = cacheReads;
    const release = owner.retain();
    const state = owner.store.getState;
    const unsubscribe = state().subscribeSelector();
    state().setAccess({ decision: "unknown", loading: false, epoch: "one" });
    cacheWaiters[0](snapshot(["disk"]));
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    await tick();
    const hydrated = { names: state().namespaces, cached: state().cached, loaded: state().loaded, reads: liveWaiters.length };
    state().refresh();
    const refreshing = { names: state().namespaces, loading: state().loading, reads: liveWaiters.length };
    liveWaiters[0].reject("network"); await tick();
    const failed = { names: state().namespaces, cached: state().cached, error: state().error };
    state().retry(); liveWaiters[1].resolve(snapshot(["live"])); await tick();
    state().refresh();
    state().setAccess({ decision: "allowed", loading: false, epoch: "two" });
    liveWaiters[2].resolve(snapshot(["obsolete"])); await tick();
    const epochCleared = state().namespaces;
    state().setAccess({ decision: "denied", loading: false, epoch: "two" });
    liveWaiters[3].resolve(snapshot(["revoked"])); await tick();
    const denied = state().namespaces;
    state().retry();
    const deniedReads = liveWaiters.length;
    unsubscribe(); release(); await tick();
    return { constructed, cacheReads, hydrated, refreshing, failed, epochCleared, denied, deniedReads, cancelled: cancelled.length, disposed: state().namespaces };
  });
  expect(result.constructed).toBe(0);
  expect(result.cacheReads).toBe(1);
  expect(result.hydrated).toEqual({ names: ["disk"], cached: true, loaded: false, reads: 0 });
  expect(result.refreshing).toEqual({ names: ["disk"], loading: true, reads: 1 });
  expect(result.failed).toEqual({ names: ["disk"], cached: true, error: "network" });
  expect(result.epochCleared).toEqual([]);
  expect(result.denied).toEqual([]);
  expect(result.deniedReads).toBe(4);
  expect(result.cancelled).toBe(2);
  expect(result.disposed).toEqual([]);
});

test("live snapshots beat late disk reads, including disposal and epoch changes", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    // @ts-expect-error Vite source fixture.
    const { createNamespaceStore } = await import("/src/app/cluster/namespaceStore.ts");
    type Snapshot = import("../src/app/cluster/namespaceCacheApi").NamespaceSnapshot;
    const scope = { clusterId: "fixture", sessionId: "lease" };
    const snapshot = (names: string[]): Snapshot => ({ ...scope, names, fetchedAt: 1, expiresAt: 2, partial: false });
    const results = [];
    for (const scenario of ["live", "epoch", "denial", "disposal"]) {
      let disk!: (value: Snapshot) => void;
      let live!: (value: Snapshot) => void;
      const owner = createNamespaceStore(scope, { loadCache: () => new Promise<Snapshot>(resolve => { disk = resolve; }),
        refreshSnapshot: () => new Promise<Snapshot>(resolve => { live = resolve; }), cancel: async () => {} });
      const release = owner.retain(), state = owner.store.getState;
      const unsubscribe = state().subscribeSelector();
      state().setAccess({ decision: "allowed", loading: false, epoch: "one" });
      if (scenario === "live") { live(snapshot(["fresh"])); await new Promise(resolve => setTimeout(resolve, 0)); }
      if (scenario === "epoch") state().setAccess({ decision: "unknown", loading: false, epoch: "two" });
      if (scenario === "denial") state().setAccess({ decision: "denied", loading: false, epoch: "one" });
      if (scenario === "disposal") { unsubscribe(); release(); await new Promise(resolve => setTimeout(resolve, 0)); }
      disk(snapshot(["obsolete"])); await new Promise(resolve => setTimeout(resolve, 0));
      results.push({ scenario, names: state().namespaces });
      unsubscribe(); release();
    }
    return results;
  });
  expect(results).toEqual([{ scenario: "live", names: ["fresh"] }, { scenario: "epoch", names: [] }, { scenario: "denial", names: [] }, { scenario: "disposal", names: [] }]);
});

test("snapshot adapter enforces identity, unique bounded names and positive bounded TTL", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite source fixture.
    const { parseNamespaceSnapshot } = await import("/src/app/cluster/namespaceCacheApi.ts");
    const scope = { clusterId: "one", sessionId: "lease" };
    const value = { ...scope, names: ["team-b", "team-a"], fetchedAt: 1, expiresAt: 2, partial: false };
    const invalid = [{ sessionId: "other" }, { names: ["duplicate", "duplicate"] }, { names: ["Bad"] },
      { names: Array.from({ length: 1001 }, (_, index) => `team-${index}`) }, { fetchedAt: 0 }, { fetchedAt: -1 },
      { expiresAt: 1 }, { expiresAt: 86_400_002 }, { partial: undefined }];
    return { valid: parseNamespaceSnapshot(value, scope).names, rejected: invalid.map(patch => {
      try { parseNamespaceSnapshot({ ...value, ...patch }, scope); return false; } catch (reason) { return reason === "invalidResponse"; }
    }) };
  });
  expect(result.valid).toEqual(["team-a", "team-b"]);
  expect(result.rejected).toEqual(Array(9).fill(true));
});

test("reload hydrates Rust metadata, keeps options on failed refresh and offers manual entry behind disclosures", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: { command: string; request: any }[] = [];
    Object.assign(window, { isTauri: true, __namespaceCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args: any) => {
        const request = args?.request;
        calls.push({ command, request });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Fixture", contextName: "fixture", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: "one", sessionId: "lease", contextName: "fixture", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1" : null, error: null };
        if (command === "cluster_permissions_review") return { ...request, authorizationEpoch: "epoch", revision: request.readId, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
          items: request.checks.map((check: any) => ({ check, decision: "unknown", reason: "reviewUnavailable" })) };
        if (command === "cluster_namespace_cache_get") return { ...request, names: ["cached-team"], fetchedAt: 1, expiresAt: 2, partial: false };
        if (command === "cluster_namespace_cache_refresh") throw "network";
        if (command === "cluster_resources") return { ...request, namespace: request.namespace ?? null, continueToken: null, metrics: null, truncated: false, fetchedAt: Date.now(), items: [] };
        return null;
      },
    } });
  });
  await page.goto("/#/cluster/one?section=vertical-pod-autoscalers");
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(page.getByText("Cached namespaces", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__namespaceCalls.filter((call: any) => call.command === "cluster_namespace_cache_refresh").length)).toBe(0);
    await expect(page.getByRole("textbox", { name: "Known namespace", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Namespace options", exact: true }).click();
    await page.getByRole("button", { name: "Enter namespace", exact: true }).click();
    await page.getByRole("button", { name: "Load namespaces", exact: true }).click();
    await expect(page.getByText(/Could not load namespaces/)).toBeVisible();
    await expect(page.getByText("Cached namespaces", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Known namespace", exact: true }).fill("team-a");
    await page.getByRole("button", { name: "Use namespace", exact: true }).click();
    await page.getByRole("button", { name: /^Namespace(?:\s|$)/ }).filter({ hasText: "team-a" }).click();
    await expect(page.getByRole("option", { name: "cached-team", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  const calls = await page.evaluate(() => (window as any).__namespaceCalls);
  expect(calls.some((call: any) => call.command === "cluster_namespace_cache_get" && call.request.clusterId === "one" && call.request.sessionId === "lease")).toBe(true);
  expect(calls.some((call: any) => call.command === "cluster_namespace_cache_refresh" && call.request.readId > 0)).toBe(true);
  expect(calls.some((call: any) => call.command === "namespace_cache_put" || call.command === "namespace_cache_get")).toBe(false);
});
