import { expect, test, type Page } from "@playwright/test";

type Request = Record<string, unknown>;
type Fixture = Window & {
  __surfaceCalls: { command: string; request: Request }[];
  __surfaceUnexpected: string[];
  __holdSurface: boolean;
  __releaseSurface: () => void;
};
const errors = new WeakMap<Page, string[]>();
const selector = (page: Page) => page.getByRole("button", { name: /^Namespace(?! options)(?:\s|$)/ });
const reads = (page: Page, command: string) => page.evaluate(command => (window as Fixture).__surfaceCalls.filter(call => call.command === command).map(call => call.request), command);
const navigate = (page: Page, section: string, definition?: string, cluster = "one") => page.evaluate(({ section, definition, cluster }) => {
  location.hash = `/cluster/${cluster}?section=${section}${definition ? `&definition=${definition}.example.test` : ""}`;
}, { section, definition, cluster });
async function choose(page: Page, namespace: string) {
  await expect(page.getByRole("status", { name: "Loading namespaces…", exact: true })).toHaveCount(0);
  await selector(page).click();
  await page.getByRole("option", { name: namespace, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", error => messages.push(error.message));
  await page.addInitScript(() => {
    const calls: Fixture["__surfaceCalls"] = [], unexpected: string[] = [], pending: (() => void)[] = [];
    let lease = 0;
    Object.assign(window, { isTauri: true, __surfaceCalls: calls, __surfaceUnexpected: unexpected, __holdSurface: false,
      __releaseSurface: () => { (window as Fixture).__holdSurface = false; pending.splice(0).forEach(resolve => resolve()); },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, unregisterCallback() {}, invoke: async (command: string, args?: { request: Request }) => {
        const r = structuredClone(args?.request ?? {}); calls.push({ command, request: r });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], pinnedItems: [],
          clusters: ["one", "two"].map(id => ({ id, name: id, contextName: id, source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, pinnedSections: [], status: "disconnected" })) };
        if (command === "catalog_connection_states") return [];
        if (command === "preferences_get") return null;
        if (command === "update_state") return { phase: "idle", version: null, error: null };
        if (command === "plugin:event|listen") return 1;
        if (["preferences_update", "plugin:event|unlisten", "cluster_permissions_cancel", "cluster_permissions_refresh", "cluster_resources_cancel", "helm_cancel", "cluster_custom_resource_definitions_cancel", "cluster_custom_resources_cancel", "cluster_disconnect"].includes(command)) return null;
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: r.clusterId, sessionId: r.sessionId ?? `lease-${++lease}`, contextName: r.clusterId,
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35" : null, error: null };
        if (command === "cluster_permissions_review") return { clusterId: r.clusterId, sessionId: r.sessionId, readId: r.readId, authorizationEpoch: String(r.sessionId), revision: 0,
          checkedAt: Date.now(), expiresAt: Date.now() + 60_000, items: (r.checks as unknown[]).map(check => ({ check, decision: "allowed", reason: null })) };
        if (command === "cluster_namespace_cache_get") return null;
        if (command === "cluster_namespace_cache_refresh") return { clusterId: r.clusterId, sessionId: r.sessionId, names: ["team-a", "team-b"], fetchedAt: Date.now(), expiresAt: Date.now() + 60_000, partial: false };
        if (command === "cluster_resources") return { ...r, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null, items: [] };
        if (command === "cluster_custom_resource_definitions") return { ...r, kind: "customResourceDefinitions", namespace: null, continueToken: null, metrics: null, truncated: false, fetchedAt: Date.now(),
          items: ["widgets", "gadgets", "globes"].map(plural => ({ name: `${plural}.example.test`, uid: `definition-${plural}`, resourceVersion: null, namespace: null, status: "Unknown", createdAt: null, node: null,
            columns: { group: "example.test", kind: plural === "globes" ? "Globe" : plural === "gadgets" ? "Gadget" : "Widget", plural, scope: plural === "globes" ? "Cluster" : "Namespaced", versions: "v1" } })) };
        if (command === "helm_table") {
          if ((window as Fixture).__holdSurface) await new Promise<void>(resolve => pending.push(resolve));
          return { ...r, truncated: false, items: [{ id: "demo", name: r.view === "charts" ? "stable/demo" : `release-${r.namespace ?? "all"}`, namespace: r.view === "charts" ? null : r.namespace ?? "team-a",
            version: "demo-1.0.0", appVersion: "1", description: r.view === "charts" ? "Cached chart" : null, status: r.view === "charts" ? null : "deployed", revision: r.view === "charts" ? null : 1, updated: r.view === "charts" ? null : "today" }] };
        }
        if (command === "cluster_custom_resources") {
          if ((window as Fixture).__holdSurface) await new Promise<void>(resolve => pending.push(resolve));
          const target = r.target as { definitionName: string; definitionUid: string };
          const plural = target.definitionName.split(".")[0], namespaced = plural !== "globes";
          return { ...r, group: "example.test", version: "v1", plural, kind: plural === "globes" ? "Globe" : plural === "gadgets" ? "Gadget" : "Widget", namespaced, continueToken: null, truncated: false,
            items: [{ name: `${plural}-${r.namespace ?? "all"}`, uid: `instance-${plural}-${r.namespace ?? "all"}`, namespace: namespaced ? r.namespace ?? "team-a" : null, createdAt: null, labelCount: 0 }] };
        }
        unexpected.push(command); throw `Unexpected command ${command}`;
      } },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/cluster/one?section=services");
  await expect(page.getByRole("table", { name: "Services", exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => (window as Fixture).__surfaceUnexpected)).toEqual([]);
  const commands = await page.evaluate(() => (window as Fixture).__surfaceCalls.map(call => call.command));
  expect(commands.filter(command => /install|upgrade|rollback|uninstall|delete|patch|create/.test(command))).toEqual([]);
});

test("Services and Helm releases retain namespace; Charts always requests null", async ({ page }) => {
  await choose(page, "team-b");
  const serviceRequest = (await reads(page, "cluster_resources")).at(-1)!;
  await navigate(page, "helm-releases");
  const table = page.getByRole("table", { name: "Helm Releases", exact: true });
  await expect(table).toContainText("release-team-b");
  await expect(selector(page)).toContainText("team-b");
  expect((await reads(page, "helm_table")).at(-1)).toEqual({ clusterId: "one", sessionId: serviceRequest.sessionId, view: "releases", namespace: "team-b", readId: expect.any(Number) });
  await page.evaluate(() => { (window as Fixture).__holdSurface = true; });
  await choose(page, "team-a");
  await expect(table).toHaveCount(0);
  await expect.poll(async () => (await reads(page, "helm_table")).at(-1)?.namespace).toBe("team-a");
  await page.evaluate(() => (window as Fixture).__releaseSurface());
  await expect(table).toContainText("release-team-a");
  const releaseReads = (await reads(page, "helm_table")).filter(r => r.view === "releases");
  await navigate(page, "helm-charts");
  await expect(page.getByRole("table", { name: "Helm Charts", exact: true })).toContainText("stable/demo");
  expect((await reads(page, "helm_table")).filter(r => r.view === "releases")).toEqual(releaseReads);
  expect((await reads(page, "helm_table")).filter(r => r.view === "charts").every(r => r.namespace === null)).toBe(true);
  await expect(selector(page)).toHaveCount(0);
  await navigate(page, "services");
  await expect(selector(page)).toContainText("team-a");
  await expect.poll(async () => (await reads(page, "cluster_resources")).at(-1)?.namespace).toBe("team-a");
});

test("custom definitions share namespaced selection and isolate cluster scope and pending rows", async ({ page }) => {
  await choose(page, "team-b");
  await navigate(page, "custom-resource-instances", "widgets");
  const widgets = page.getByRole("table", { name: "Widget custom resources", exact: true });
  await expect(widgets).toContainText("widgets-team-b");
  const request = (await reads(page, "cluster_custom_resources")).at(-1)!;
  expect(request).toEqual({ clusterId: "one", sessionId: expect.any(String), readId: expect.any(Number), namespace: "team-b", continueToken: null,
    target: { definitionName: "widgets.example.test", definitionUid: "definition-widgets" } });
  await page.evaluate(() => { (window as Fixture).__holdSurface = true; });
  await choose(page, "team-a");
  await expect(widgets).toHaveCount(0);
  await expect.poll(async () => (await reads(page, "cluster_custom_resources")).at(-1)?.namespace).toBe("team-a");
  await page.evaluate(() => (window as Fixture).__releaseSurface());
  await expect(widgets).toContainText("widgets-team-a");
  await navigate(page, "custom-resource-instances", "gadgets");
  await expect(page.getByRole("table", { name: "Gadget custom resources", exact: true })).toContainText("gadgets-team-a");
  await expect(widgets).toHaveCount(0);
  expect((await reads(page, "cluster_custom_resources")).at(-1)).toMatchObject({ namespace: "team-a", target: { definitionUid: "definition-gadgets" } });
  await navigate(page, "custom-resource-instances", "globes");
  await expect(page.getByRole("table", { name: "Globe custom resources", exact: true })).toContainText("globes-all");
  await expect(selector(page)).toHaveCount(0);
  expect((await reads(page, "cluster_custom_resources")).at(-1)).toMatchObject({ namespace: null, target: { definitionUid: "definition-globes" } });
  await navigate(page, "helm-releases");
  await expect(selector(page)).toContainText("team-a");
  await expect(page.getByRole("table", { name: "Helm Releases", exact: true })).toContainText("release-team-a");
});

test("cluster and replacement sessions reset selection on remaining surfaces", async ({ page }) => {
  await choose(page, "team-b");
  await navigate(page, "helm-releases", undefined, "two");
  await expect(selector(page)).toContainText("All namespaces");
  await expect.poll(async () => (await reads(page, "helm_table")).at(-1)).toMatchObject({ clusterId: "two", namespace: null });
  await choose(page, "team-a");
  await navigate(page, "custom-resource-instances", "widgets", "two");
  await expect(page.getByRole("table", { name: "Widget custom resources", exact: true })).toContainText("widgets-team-a");
  const oldLease = (await reads(page, "cluster_custom_resources")).at(-1)!.sessionId;
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
  await expect(selector(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh custom-resource-instances", exact: true }).click();
  await expect(selector(page)).toContainText("All namespaces");
  await expect.poll(async () => (await reads(page, "cluster_custom_resources")).at(-1)?.sessionId).not.toBe(oldLease);
  expect((await reads(page, "cluster_custom_resources")).at(-1)?.namespace).toBeNull();
});
