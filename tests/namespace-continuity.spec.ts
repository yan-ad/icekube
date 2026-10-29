import { expect, test, type Page } from "@playwright/test";

type Request = Record<string, unknown>;
type Fixture = Window & { __scopeCalls: { command: string; request: Request }[]; __scopeUnexpected: string[]; __holdScope: boolean; __releaseScope: () => void };
const selector = (page: Page) => page.getByRole("button", { name: /^Namespace(?! options)(?:\s|$)/ });
const reads = (page: Page, kind: string) => page.evaluate(kind => (window as Fixture).__scopeCalls.filter(call => call.command === "cluster_resources" && call.request.kind === kind).map(call => call.request), kind);
const discoveryReads = (page: Page) => page.evaluate(() => (window as Fixture).__scopeCalls.filter(call => call.command === "cluster_namespace_cache_refresh").map(call => call.request));
const navigate = (page: Page, section: string, cluster = "one") => page.evaluate(({ section, cluster }) => { location.hash = `/cluster/${cluster}?section=${section}`; }, { section, cluster });
async function choose(page: Page, namespace: string) {
  await expect(page.getByRole("status", { name: "Loading namespaces…", exact: true })).toHaveCount(0);
  await selector(page).click();
  await page.getByRole("option", { name: namespace, exact: true }).click();
}
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as Fixture).__scopeUnexpected ?? [])).toEqual([]);
});
async function fixture(page: Page) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(() => {
    const calls: Fixture["__scopeCalls"] = [], pending: (() => void)[] = [], unexpected: string[] = [];
    let lease = 0;
    Object.assign(window, { isTauri: true, __scopeCalls: calls, __scopeUnexpected: unexpected, __holdScope: false,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __releaseScope: () => pending.splice(0).forEach(resolve => resolve()),
      __TAURI_INTERNALS__: { transformCallback: () => 1, unregisterCallback() {}, invoke: async (command: string, args?: { request: Request }) => {
        const request = structuredClone(args?.request ?? {}); calls.push({ command, request });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: ["one", "two"].map(id => ({ id, name: id, contextName: id, source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" })) };
        if (command === "catalog_connection_states") return [];
        if (command === "preferences_get") return null;
        if (command === "update_state") return { phase: "idle", version: null, error: null };
        if (command === "plugin:event|listen") return 1;
        if (command === "cluster_namespace_cache_get" || command === "cluster_namespace_cache_refresh") {
          if (typeof request.clusterId !== "string" || typeof request.sessionId !== "string"
            || command === "cluster_namespace_cache_refresh" && (!Number.isSafeInteger(request.readId) || Number(request.readId) <= 0)) throw "invalidInput";
          const fetchedAt = Date.now();
          return { clusterId: request.clusterId, sessionId: request.sessionId, names: ["team-a", "team-b"], fetchedAt, expiresAt: fetchedAt + 60_000, partial: false };
        }
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: request.clusterId, sessionId: request.sessionId ?? `lease-${++lease}`, contextName: request.clusterId, status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, authorizationEpoch: String(request.sessionId), revision: 0, checkedAt: Date.now(), expiresAt: Date.now() + 30000, items: (request.checks as unknown[]).map(check => ({ check, decision: "allowed", reason: null })) };
        if (["plugin:event|unlisten", "cluster_permissions_cancel", "cluster_resources_cancel", "cluster_disconnect"].includes(command)) return null;
        if (command !== "cluster_resources") { unexpected.push(command); throw `Unexpected command: ${command}`; }
        if ((window as Fixture).__holdScope && request.kind !== "namespaces") await new Promise<void>(resolve => pending.push(resolve));
        const namespace = request.namespace ?? "team-a";
        const names = request.kind === "namespaces" ? ["team-a", "team-b"] : [`${request.kind}-${namespace}`];
        return { ...request, namespace: request.namespace ?? null, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null,
          items: names.map(name => ({ name, namespace: request.kind === "namespaces" ? null : namespace, uid: `uid-${name}`, status: "Unknown", createdAt: null, columns: request.kind === "events" ? { message: name } : {}, node: null })) };
      } },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/cluster/one?section=pods");
  await expect(page.getByRole("table", { name: "Pods", exact: true })).toBeVisible();
}

test("resource pages and overview title navigation share namespace without extra discovery", async ({ page }) => {
  await fixture(page);
  await choose(page, "team-b");
  await expect.poll(async () => (await reads(page, "pods")).at(-1)?.namespace).toBe("team-b");
  const discovery = await discoveryReads(page);
  expect(discovery.length).toBeGreaterThan(0);
  expect(discovery.every(request => request.clusterId === "one" && typeof request.sessionId === "string" && Number.isSafeInteger(request.readId))).toBe(true);
  await navigate(page, "services");
  await expect(selector(page)).toContainText("team-b");
  await expect.poll(async () => (await reads(page, "services")).at(-1)?.namespace).toBe("team-b");
  await navigate(page, "workloads-overview");
  await expect(selector(page)).toContainText("team-b");
  await expect(page.getByRole("table", { name: "Latest events", exact: true })).toContainText("events-team-b");
  await choose(page, "team-a");
  await expect(page.getByRole("table", { name: "Latest events", exact: true })).toContainText("events-team-a");
  await page.getByRole("region", { name: "Deployments inventory", exact: true }).getByRole("link", { name: "Deployments", exact: true }).click();
  await expect(selector(page)).toContainText("team-a");
  await expect.poll(async () => (await reads(page, "deployments")).at(-1)?.namespace).toBe("team-a");
  expect(await discoveryReads(page)).toEqual(discovery);
});

test("namespace cells filter lists and pending scope changes clear old rows", async ({ page }) => {
  await fixture(page);
  const table = page.getByRole("table", { name: "Pods", exact: true });
  await table.getByRole("button", { name: "Filter to namespace team-a", exact: true }).click();
  await expect(selector(page)).toContainText("team-a");
  await expect.poll(async () => (await reads(page, "pods")).at(-1)?.namespace).toBe("team-a");
  await expect(table).toBeVisible();
  await page.evaluate(() => { (window as Fixture).__holdScope = true; });
  await choose(page, "team-b");
  await expect(table).toHaveCount(0);
  await expect.poll(async () => (await reads(page, "pods")).at(-1)?.namespace).toBe("team-b");
  await navigate(page, "services");
  await expect(selector(page)).toContainText("team-b");
  await page.evaluate(() => { (window as Fixture).__holdScope = false; (window as Fixture).__releaseScope(); });
  await expect(page.getByRole("table", { name: "Services", exact: true })).toContainText("services-team-b");
  expect(await page.evaluate(() => (window as Fixture).__scopeCalls.some(call => call.command === "cluster_resource_detail" || call.command === "cluster_resource_delete"))).toBe(false);
});

test("cluster-scoped pages do not receive namespace filters and switching cluster resets selection", async ({ page }) => {
  await fixture(page); await choose(page, "team-b");
  await navigate(page, "namespaces");
  await expect(page.getByRole("table", { name: "Namespaces", exact: true })).toBeVisible();
  expect((await reads(page, "namespaces")).at(-1)?.namespace).toBeNull();
  await navigate(page, "pods");
  await expect(selector(page)).toContainText("team-b");
  await navigate(page, "pods", "two");
  await expect(selector(page)).toContainText("All namespaces");
  await expect.poll(async () => (await reads(page, "pods")).at(-1)).toMatchObject({ clusterId: "two", namespace: null });
});

test("disconnect and a replacement lease on the same cluster reset namespace", async ({ page }) => {
  await fixture(page); await choose(page, "team-b");
  await expect.poll(async () => (await reads(page, "pods")).at(-1)?.namespace).toBe("team-b");
  const oldLease = (await reads(page, "pods")).at(-1)!.sessionId;
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
  await expect(selector(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh pods", exact: true }).click();
  await expect(selector(page)).toContainText("All namespaces");
  await expect.poll(async () => (await reads(page, "pods")).at(-1)?.sessionId).not.toBe(oldLease);
  expect((await reads(page, "pods")).at(-1)?.namespace).toBeNull();
});
