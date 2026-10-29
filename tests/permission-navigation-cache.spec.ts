import { expect, test } from "@playwright/test";

test("navigation observations survive renewal failures but never grant stale permissions or cross identity boundaries", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { decision: "denied", epoch: "first", fail: false, calls: 0, refreshes: 0 };
    Object.assign(window, { isTauri: true, __navigationCache: state, __TAURI_INTERNALS__: {
      invoke: async (command: string, args: any) => {
        if (command === "cluster_permissions_refresh") { state.refreshes++; return null; }
        if (command !== "cluster_permissions_review") return null;
        state.calls++;
        if (state.fail) throw "network";
        const { clusterId, sessionId, readId, checks } = args.request;
        return { clusterId, sessionId, readId, authorizationEpoch: state.epoch, revision: state.calls,
          checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
          items: checks.map((check: any) => ({ check, decision: state.decision, reason: state.decision === "denied" ? "reviewDenied" : state.decision === "unknown" ? "reviewUnavailable" : null })) };
      },
    } });
  });
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/app/cluster/PermissionProvider.tsx";
    const { PermissionStore } = await import(/* @vite-ignore */ path);
    const store = new PermissionStore();
    const state = (window as any).__navigationCache;
    const nodes = { kind: "nodes", action: "list", namespace: null, name: null } as const;
    const volumes = { kind: "persistentVolumes", action: "list", namespace: null, name: null } as const;
    const read = async () => {
      for (let i = 0; i < 100 && store.loading([nodes]); i++) await new Promise(resolve => setTimeout(resolve, 5));
      if (store.loading([nodes])) throw new Error("Permission review did not settle");
    };
    const release = store.setContext({ clusterId: "cluster", sessionId: "first" });
    const unsubscribe = store.request([nodes]);
    const initial = store.navigationVisible(nodes, "cluster");
    await read();
    const denied = store.navigationVisible(nodes, "cluster");
    state.decision = "unknown";
    store.retry();
    const pending = { visible: store.navigationVisible(nodes), decision: store.decision(nodes) };
    await read();
    const unknownAfterDenied = { visible: store.navigationVisible(nodes), decision: store.decision(nodes) };
    state.fail = true;
    store.retry(); await read();
    const failedAfterDenied = store.navigationVisible(nodes);
    state.fail = false; state.decision = "allowed";
    store.retry(); await read();
    const allowed = store.navigationVisible(nodes);
    const wrongCluster = store.navigationVisible(nodes, "other");
    state.decision = "unknown";
    store.retry(); await read();
    const unknownAfterAllowed = { visible: store.navigationVisible(nodes), decision: store.decision(nodes) };
    state.decision = "denied"; state.epoch = "second";
    const unsubscribeVolumes = store.request([volumes]);
    await new Promise<void>(resolve => {
      const stop = store.subscribe(() => {
        if (store.authorizationEpoch() === "second") { stop(); resolve(); }
      });
    });
    const newEpoch = { visible: store.navigationVisible(nodes), decision: store.decision(nodes) };
    await read();
    const afterNewEpoch = store.navigationVisible(nodes);
    const releaseReplacement = store.setContext({ clusterId: "other", sessionId: "replacement" });
    const replacement = store.navigationVisible(nodes, "other");
    release();
    state.decision = "unknown";
    await read();
    const firstUnknown = store.navigationVisible(nodes, "other");
    unsubscribe(); unsubscribeVolumes(); releaseReplacement();
    return { initial, denied, pending, unknownAfterDenied, failedAfterDenied, allowed, wrongCluster, unknownAfterAllowed,
      newEpoch, afterNewEpoch, replacement, firstUnknown, released: store.navigationVisible(nodes), refreshes: state.refreshes };
  });
  expect(result).toEqual({ initial: false, denied: false, pending: { visible: false, decision: "unknown" },
    unknownAfterDenied: { visible: false, decision: "unknown" }, failedAfterDenied: false, allowed: true, wrongCluster: false,
    unknownAfterAllowed: { visible: true, decision: "unknown" }, newEpoch: { visible: false, decision: "unknown" },
    afterNewEpoch: false, replacement: false, firstUnknown: true, released: false, refreshes: 4 });
});
