import { expect, test, type Locator, type Page } from "@playwright/test";
import { resourceViews } from "../src/app/cluster/resourceViews";

type Request = Record<string, any>;
type Fixture = Window & { __detailColumnUnexpected: string[] };
const panel = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });

// Synthetic IPC follows the pane-accessibility, compact-inspector and Helm fixtures.
async function fixture(page: Page, section: string) {
  await page.addInitScript(views => {
    const unexpected: string[] = [];
    const item = (kind: string) => ({ name: "sample-a", namespace: views.find(view => view.kind === kind)?.namespaced ? "team-a" : null,
      uid: "fixture-uid", resourceVersion: "version-1", createdAt: "2026-10-01T00:00:00Z", status: "Running",
      node: kind === "nodes" ? { roles: ["worker"], taints: 0, version: "v1.35.8", internalIps: ["192.0.2.1"], schedulable: true, diskAllocatable: null, metricsTimestamp: null,
        cpu: { used: null, allocatable: 4, capacity: 4 }, memory: { used: null, allocatable: 4, capacity: 4 }, conditions: [{ type: "Ready", status: "True" }] } : null,
      columns: Object.fromEntries((views.find(view => view.kind === kind)?.columns ?? []).slice(0, 12).map(column => [column.key, "1"])) });
    Object.assign(window, { isTauri: true, __detailColumnUnexpected: unexpected,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, unregisterCallback() {}, invoke: async (command: string, args?: { request: Request }) => {
        const r = args?.request ?? {};
        if (command === "plugin:event|listen") return 1;
        if (command === "plugin:event|unlisten" || command.endsWith("_cancel") || command === "cluster_disconnect" || command === "cluster_permissions_refresh") return null;
        if (command === "preferences_get") return null;
        if (command === "update_state") return { phase: "idle", version: null, error: null };
        if (command === "catalog_connection_states") return [];
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], pinnedItems: [], clusters: [{ id: "one", name: "Fixture cluster", contextName: "fixture", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, pinnedSections: [], status: "disconnected" }] };
        if (command === "cluster_permissions_review") return { clusterId: r.clusterId, sessionId: r.sessionId, readId: r.readId, authorizationEpoch: "fixture", revision: 1, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
          items: r.checks.map((check: unknown) => ({ check, decision: "allowed", reason: null })) };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: "one", sessionId: r.sessionId ?? "columns-lease", contextName: "fixture", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        if (command === "cluster_namespace_cache_get" || command === "cluster_namespace_cache_refresh") return { ...r, names: ["team-a"], fetchedAt: Date.now(), expiresAt: Date.now() + 60_000, partial: false };
        if (command === "cluster_resources") return { ...r, namespace: r.namespace ?? null, items: [item(r.kind)], continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null };
        if (command === "cluster_resource_detail") return { ...r, item: item(r.reference.kind), related: {}, metadata: {
          labels: [{ key: "example/" + "long-key".repeat(30), value: "long-value".repeat(60) }, { key: "app", value: "fixture" }],
          annotations: [{ key: "example/note", value: "readable note ".repeat(40) }, { key: "example/owner", value: "team-a" }],
          finalizers: ["example/cleanup", "example/archive"], deletionTimestamp: null, partial: false,
          managedFields: [{ manager: "fixture-controller", operation: "Update", apiVersion: "v1", time: null, subresource: null, fields: '[["spec","replicas"]]' }],
        } };
        if (command === "cluster_resource_collection") return { ...r, state: "complete", items: [] };
        if (command === "cluster_pod_forward_list") return [];
        if (command === "cluster_pod_detail") return { ...r, uid: "fixture-uid", resourceVersion: "version-1", phase: "Running", node: "node-a", podIps: ["192.0.2.1"], hostIps: [], serviceAccount: "default", qos: "Burstable", createdAt: null, deletionTimestamp: null,
          conditions: [{ type: "Ready", status: "True" }, { type: "Scheduled", status: "True" }],
          containers: [{ name: "api", image: "example/" + "long-image".repeat(50), kind: "container", state: "running", ready: true, restarts: 0, ports: [] }],
          eventsState: "complete", events: [{ reason: "Scheduled", type: "Normal", count: 1, lastSeen: "2026-10-29T12:00:00Z" }], yaml: "apiVersion: v1\nkind: Pod\n" };
        if (command === "helm_table") return { ...r, truncated: false, items: [{ id: "demo", name: r.view === "charts" ? "stable/sample-a" : "sample-a", namespace: r.view === "charts" ? null : "team-a", version: "1.0.0", appVersion: "1", description: r.view === "charts" ? "Fixture chart" : null, status: r.view === "charts" ? null : "deployed", revision: r.view === "charts" ? null : 2, updated: r.view === "charts" ? null : "today" }] };
        if (command === "helm_detail") return { ...r, truncated: false, facts: r.view === "charts" ? [{ label: "Description", value: "Chart metadata ".repeat(40) }, { label: "Maintainer", value: "Fixture team" }] : [],
          history: r.view === "releases" ? [{ revision: 2, updated: "today", status: "deployed", chart: "demo-1.0.0", appVersion: "1" }] : [] };
        unexpected.push(command); throw new Error(`Unexpected detail columns command: ${command}`);
      } },
    });
  }, resourceViews);
  await page.setViewportSize({ width: 1568, height: 1000 });
  await page.goto(`/#/cluster/one?section=${section}`);
  await page.getByRole("table").getByRole("button", { name: section === "helm-charts" ? "stable/sample-a" : "sample-a", exact: true }).click();
  await expect(panel(page).locator(".detail-list").first()).toBeVisible();
}

async function geometry(lists: Locator, columns: number) {
  await expect.poll(async () => lists.evaluateAll(elements => elements.map(element => {
    const grid = element.querySelector("dl")!;
    const items = [...grid.children].map(child => child.getBoundingClientRect());
    return { columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      rowMajor: items.length < 2 || (Math.abs(items[0].y - items[1].y) < 1 ? items[1].x > items[0].x : items[1].y > items[0].y),
      contained: [...element.querySelectorAll("dt, dd")].every(child => child.scrollWidth <= child.clientWidth + 1) };
  }))).toEqual(Array.from({ length: await lists.count() }, () => ({ columns, rowMajor: true, contained: true })));
}

for (const theme of ["light", "dark"] as const) for (const section of ["nodes", "pods", "helm-releases", "helm-charts"]) {
  test(`${section} detail columns use panel width and reflow at 200% text (${theme})`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await fixture(page, section);
    const lists = panel(page).locator(".detail-list");
    const handle = page.getByRole("separator", { name: "Resize resource details" });
    await handle.focus(); await handle.press("Home");
    await geometry(lists, 1);
    await panel(page).getByRole("button", { name: "Expand inspector", exact: true }).click();
    await geometry(lists, 2);
    const wide = await lists.first().boundingBox();
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await geometry(lists, 1);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await geometry(lists, 2);
    if (section === "nodes") {
      const disclosure = panel(page).getByRole("button", { name: "Show managed fields", exact: true });
      await disclosure.focus(); await disclosure.press("Enter");
      const managed = panel(page).locator(".astryx-metadata-list").filter({ hasText: "fixture-controller (Update)" });
      expect(await managed.evaluate(element => getComputedStyle(element.querySelector("dl")!).gridTemplateColumns.split(" ").length)).toBe(1);
      await panel(page).getByRole("button", { name: "Hide managed fields", exact: true }).click();
    }
    await panel(page).getByRole("button", { name: "Restore inspector width", exact: true }).click();
    await geometry(lists, 1);
    await page.setViewportSize({ width: 390, height: 800 });
    await geometry(lists, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await panel(page).locator(".resource-inspector-body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await info.attach("detail-column-geometry", { body: JSON.stringify({ section, theme, wide, narrow: await lists.first().boundingBox() }), contentType: "application/json" });
    await panel(page).getByRole("button", { name: "Close inspector", exact: true }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => (window as Fixture).__detailColumnUnexpected)).toEqual([]);
  });
}
