import { expect, test, type Page } from "@playwright/test";

async function searchFixture(page: Page, options: { holdCatalog?: boolean; failCatalog?: boolean; empty?: boolean; holdPermissions?: boolean } = {}) {
  await page.addInitScript(options => {
    const state = { calls: [] as string[], nodes: "denied", pods: "denied", epoch: "first", reviews: 0,
      catalogWaiters: [] as (() => void)[], permissionWaiters: [] as (() => void)[], ...options };
    const clusters = [
      { id: "one", name: "Development", contextName: "team-sandbox", source: "kubeconfig", labels: ["file=/fixtures/development.yaml"], color: "#476BA1", status: "disconnected", pinned: false },
      { id: "two", name: "Development", contextName: "team-prod", source: "kubeconfig", labels: [], color: "#476BA1", status: "disconnected", pinned: false },
    ];
    Object.assign(window, { isTauri: true, __appSearch: state, __TAURI_INTERNALS__: {
      invoke: async (command: string, args: any) => {
        state.calls.push(command);
        const request = args?.request;
        if (command === "catalog_list") {
          if (state.holdCatalog) await new Promise<void>(resolve => state.catalogWaiters.push(resolve));
          if (state.failCatalog) throw "storeCorrupt";
          return { revision: 1, discoveryError: null, webLinks: [], clusters: state.empty ? [] : clusters };
        }
        if (command === "cluster_session_open") return { clusterId: request.clusterId, sessionId: `${request.clusterId}-session`, contextName: request.clusterId === "one" ? "team-sandbox" : "team-prod", status: "disconnected", apiVersion: null, error: null };
        if (command === "cluster_connect") return { ...request, contextName: request.clusterId === "one" ? "team-sandbox" : "team-prod", status: "connected", apiVersion: "v1.35.8", error: null };
        if (command === "cluster_permissions_review") {
          state.reviews++;
          if (state.holdPermissions) await new Promise<void>(resolve => state.permissionWaiters.push(resolve));
          return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
            authorizationEpoch: state.epoch, revision: state.reviews, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
            items: request.checks.map((check: any) => { const decision = check.kind === "nodes" ? state.nodes : check.kind === "pods" ? state.pods : "allowed";
              return { check, decision, reason: decision === "allowed" ? null : decision === "unknown" ? "reviewUnavailable" : "reviewDenied" }; }) };
        }
        if (command === "cluster_resources") return { ...request, namespace: request.namespace ?? null, continueToken: null, metrics: null, items: [], truncated: false, fetchedAt: Date.now() };
        if (command === "catalog_connection_states") return [];
        return null;
      },
    } });
  }, options);
}

test("cluster-only results open the workspace and Escape returns focus to the toolbar trigger", async ({ page }) => {
  await searchFixture(page);
  await page.goto("/#/catalog");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search Iceon", exact: true });
  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeFocused();
  await openSearch(page);
  await input.fill("team-prod");
  await dialog.getByRole("option", { name: "Development Context: team-prod", exact: true }).click();
  await expect(page).toHaveURL(/#\/cluster\/two\?section=overview$/);
});

async function openSearch(page: Page) {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search Iceon", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox")).toBeFocused();
  return dialog;
}

test("cluster/context and nested menu search stay local and select the exact duplicate-name cluster", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await searchFixture(page);
  await page.goto("/#/catalog");
  await expect(page.getByRole("table").getByRole("cell", { name: "Development", exact: true })).toHaveCount(2);
  const dialog = await openSearch(page);
  const before = await page.evaluate(() => (window as any).__appSearch.calls.length);
  const input = dialog.getByRole("combobox");
  await input.fill("TEAM-PROD workLoads pods");
  const option = dialog.getByRole("option");
  await expect(option).toHaveCount(1);
  await expect(option).toContainText("Development › Workloads › Pods");
  await expect(option).toContainText("team-prod · Access unverified");
  expect(await page.evaluate(() => (window as any).__appSearch.calls.length)).toBe(before);
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page).toHaveURL(/#\/cluster\/two\?section=pods$/);
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("cached RBAC hides cluster-wide denial, retains namespace choices, and never leaks across clusters", async ({ page }) => {
  await searchFixture(page);
  await page.goto("/#/cluster/one?section=deployments");
  await expect(page.getByRole("table", { name: "Deployments", exact: true })).toBeVisible();
  const dialog = await openSearch(page);
  const input = dialog.getByRole("combobox");
  await input.fill("team-sandbox nodes");
  await expect(dialog.getByRole("option")).toHaveCount(0);
  await input.fill("team-prod nodes");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(dialog.getByRole("option")).toContainText("Access unverified");
  await input.fill("team-sandbox pods");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(dialog.getByRole("option")).toContainText("Choose a namespace to check access");
  await input.fill("team-sandbox namespaces");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(dialog.getByRole("option")).not.toContainText("Access unverified");
  await input.fill("team-sandbox nodes");
  await expect(dialog.getByRole("option")).toHaveCount(0);
  await input.press("Escape");
  await page.goto("/#/cluster/one?section=nodes");
  await expect(page.getByText("Access denied", { exact: true })).toBeVisible();
});

test("RBAC renewal updates the open query without revealing a previously denied menu", async ({ page }) => {
  await page.clock.install();
  await searchFixture(page);
  await page.goto("/#/cluster/one?section=deployments");
  await expect(page.getByRole("table", { name: "Deployments", exact: true })).toBeVisible();
  const dialog = await openSearch(page);
  const input = dialog.getByRole("combobox");
  await input.fill("team-sandbox nodes");
  await expect(dialog.getByRole("option")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__appSearch.holdPermissions = true; });
  await page.clock.fastForward(30_001);
  await expect.poll(() => page.evaluate(() => (window as any).__appSearch.permissionWaiters.length)).toBe(1);
  await expect(input).toHaveValue("team-sandbox nodes");
  await expect(dialog.getByRole("option")).toHaveCount(0);
  await page.evaluate(() => {
    const state = (window as any).__appSearch;
    state.nodes = "allowed"; state.holdPermissions = false;
    state.permissionWaiters.splice(0).forEach((resolve: () => void) => resolve());
  });
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(input).toHaveValue("team-sandbox nodes");
  await page.evaluate(() => { (window as any).__appSearch.nodes = "denied"; });
  await page.clock.fastForward(30_001);
  await expect(dialog.getByRole("option")).toHaveCount(0);
});

test("a catalog arriving while search is open updates results without losing the query", async ({ page }) => {
  await searchFixture(page, { holdCatalog: true });
  await page.goto("/#/catalog");
  const dialog = await openSearch(page);
  await expect(dialog.getByText("Loading saved clusters…")).toBeVisible();
  await dialog.getByRole("combobox").fill("team-prod pods");
  await expect(dialog.getByRole("option")).toHaveCount(0);
  await page.evaluate(() => {
    const state = (window as any).__appSearch;
    state.holdCatalog = false; state.catalogWaiters.splice(0).forEach((resolve: () => void) => resolve());
  });
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(dialog.getByRole("combobox")).toHaveValue("team-prod pods");
});

for (const state of ["empty", "failed", "preview"] as const) {
  test(`search preserves page navigation with ${state} catalog`, async ({ page }) => {
    if (state !== "preview") await searchFixture(page, { empty: state === "empty", failCatalog: state === "failed" });
    await page.goto("/#/catalog");
    const dialog = await openSearch(page);
    await expect(dialog.getByText(state === "empty" ? "No saved clusters. Add a kubeconfig in Catalog." : state === "failed" ? /saved catalog is invalid/ : "Open the desktop app to search saved clusters.")).toBeVisible();
    await dialog.getByRole("combobox").fill("Web Links");
    await dialog.getByRole("option", { name: /Web Links/ }).click();
    await expect(page).toHaveURL(/#\/catalog\/web-links$/);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: cluster results fit narrow layouts and reopening clears the query`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 360, height: 640 });
    await searchFixture(page);
    await page.goto("/#/catalog");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("development validating admission policy bindings");
    await expect(dialog.getByRole("option")).toHaveCount(2);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`search-${theme}-narrow.png`) });
    await dialog.getByRole("combobox").press("Escape");
    await expect(dialog).not.toBeVisible();
    await openSearch(page);
    await expect(dialog.getByRole("combobox")).toHaveValue("");
  });
}

test("local index handles 1,000 clusters with bounded results, exact resolution and selection-time RBAC", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/app/components/appSearchSource.ts";
    const { createAppSearchSource, indexSearchClusters, SEARCH_RESULT_LIMIT } = await import(/* @vite-ignore */ path);
    const clusters = Array.from({ length: 1000 }, (_, i) => ({ id: `cluster-${i}`, name: `Cluster ${i}`, contextName: `context-${i}`, labels: [], pinnedSections: [], pinned: false, source: "kubeconfig", status: "disconnected", color: "#476BA1" }));
    let denied = false;
    const source = createAppSearchSource(indexSearchClusters(clusters), "cluster-999", (id: string, section: string) => denied && id === "cluster-999" && section === "nodes" ? "hidden" : "unverified");
    const target = source.search("context-999 nodes")[0];
    const exact = source.resolve(target.id);
    denied = true;
    const afterDenial = source.resolve(target.id);
    const malformed = ["[]", "null", '["missing","pods"]', '["cluster-999","made-up"]'].map(id => source.resolve(id));
    const deniedGroups = createAppSearchSource(indexSearchClusters(clusters.slice(0, 1)), "cluster-0", () => "hidden");
    const started = performance.now();
    const times: number[] = [];
    for (let i = 0; i < 200; i++) { const now = performance.now(); source.search(i % 2 ? "context-999 workload pods" : "no-such-menu"); times.push(performance.now() - now); }
    times.sort((a, b) => a - b);
    return { exact, afterDenial, malformed, bootstrap: source.bootstrap().length, broad: source.search("pods").length, limit: SEARCH_RESULT_LIMIT,
      hiddenGroup: deniedGroups.search("storage").length, deniedGroupSelection: deniedGroups.resolve('["cluster-0","storage"]'),
      normalized: source.search("CONTEXT_999 workload PODS").length, averageMs: (performance.now() - started) / 200, p95Ms: times[189] };
  });
  expect(result.exact).toEqual({ type: "cluster", clusterId: "cluster-999", section: "nodes" });
  expect(result.afterDenial).toBeNull();
  expect(result.malformed).toEqual([null, null, null, null]);
  expect(result.bootstrap).toBeLessThanOrEqual(result.limit);
  expect(result.broad).toBe(result.limit);
  expect(result.normalized).toBe(1);
  expect(result.hiddenGroup).toBe(0);
  expect(result.deniedGroupSelection).toBeNull();
  expect(result.p95Ms).toBeLessThan(50);
  console.log(`1,000-cluster local search: mean ${result.averageMs.toFixed(2)}ms, p95 ${result.p95Ms.toFixed(2)}ms`);
});
