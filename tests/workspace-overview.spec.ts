import { expect, test, type Page } from "@playwright/test";

type Controls = { metrics?: string; partial?: boolean; failure?: boolean; empty?: boolean; hold?: boolean; missing?: boolean };
type Fixture = Window & { __clusterOverview: Controls; __clusterReads: Record<string, unknown>[]; __releaseCluster: () => void };
async function fixture(page: Page, control: Controls = {}) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(control => {
    const calls: Record<string, unknown>[] = [], pending: (() => void)[] = [];
    const item = (name: string, namespace: string | null, status: string, columns: Record<string, string> = {}) => ({ name, namespace, uid: `uid-${name}`, status, columns, createdAt: "2026-10-01T00:00:00Z", node: null });
    Object.assign(window, { isTauri: true, __clusterOverview: control, __clusterReads: calls,
      __releaseCluster: () => pending.splice(0).forEach(resolve => resolve()),
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} }, __TAURI_INTERNALS__: {
        transformCallback: () => 1, unregisterCallback() {},
        invoke: async (command: string, args?: { request?: Record<string, unknown> }) => {
          const request = args?.request ?? {}; calls.push({ command, ...structuredClone(request) });
          if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
            authorizationEpoch: String(request.sessionId), revision: 0, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
            items: (request.checks as unknown[]).map(check => ({ check, decision: "allowed", reason: null })) };
          if (command === "cluster_permissions_cancel" || command === "cluster_permissions_refresh") return null;
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten" || command.endsWith("_cancel") || command === "cluster_disconnect") return null;
          if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
          if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: request.clusterId, sessionId: request.sessionId ?? "overview", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
          if (command !== "cluster_resources") throw "invalidInput";
          if (request.kind === "nodes" && control.hold) await new Promise<void>(resolve => pending.push(resolve));
          if (request.kind === "nodes" && control.failure) throw "permissionDenied";
          const node = { ...item("node-one", null, "Ready"), node: { roles: [], taints: 0, version: "v1.35.8", internalIps: [], schedulable: true, conditions: [{ type: "Ready", status: "True" }], diskAllocatable: null,
            cpu: { used: control.missing ? null : 1, allocatable: 4, capacity: 4 }, memory: { used: 1073741824, allocatable: 4294967296, capacity: 4294967296 }, metricsTimestamp: "2026-10-27T00:00:00Z" } };
          const items = control.empty ? [] : request.kind === "nodes" ? [node] : request.kind === "events" ? [
            item("old", "team-a", "Warning", { type: "Warning", message: "Older warning", source: "kubelet", count: "1", lastSeen: "2026-10-01T00:00:00Z" }),
            item("new", "team-a", "Warning", { type: "Warning", message: "Latest warning", source: "scheduler", count: "2", lastSeen: "2026-10-25T00:00:00Z", involvedObject: "Pod/pending" }),
            item("normal", "team-a", "Normal", { type: "Normal", message: "Not a warning" }),
          ] : [];
          return { ...request, namespace: null, items, continueToken: control.partial ? "more" : null, truncated: !!control.partial, fetchedAt: Date.now(), metrics: request.kind === "nodes" ? control.metrics ?? "available" : null };
        },
      },
    });
  }, control);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/cluster/one");
}

test("overview uses actual utilization and bounded, sorted warning events", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("region", { name: "CPU utilization", exact: true })).toContainText("25.0% used");
  await expect(page.getByRole("region", { name: "Memory utilization", exact: true })).toContainText("1.00 GiB / 4.00 GiB allocatable");
  await expect(page.getByText("Ready nodes: 1", { exact: true })).toBeVisible();
  const events = page.getByRole("table", { name: "Latest warning events" });
  await expect(events.getByRole("row").nth(1)).toContainText("Latest warning");
  await expect(events).not.toContainText("Not a warning");
  await page.getByRole("button", { name: "About cluster overview", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "About cluster overview" })).toContainText("Historical charts unavailable");
  await page.keyboard.press("Escape");
  const reads = await page.evaluate(() => (window as Fixture).__clusterReads.filter(call => call.command === "cluster_resources"));
  expect(reads.filter(read => read.kind === "events").every(read => read.status === "Warning")).toBe(true);
  expect(reads.every(read => !read.continueToken)).toBe(true);
  await events.getByRole("button", { name: "Pod/pending", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Fixture).__clusterReads.filter(call => call.command === "cluster_resource_detail").map(call => call.reference))).toContainEqual({ kind: "events", namespace: "team-a", name: "new", uid: "uid-new" });
});

for (const control of [{ metrics: "unavailable" }, { metrics: "stale" }, { partial: true }, { missing: true }]) {
  test(`does not invent utilization for ${JSON.stringify(control)}`, async ({ page }) => {
    await fixture(page, control);
    const cpu = page.getByRole("region", { name: "CPU utilization", exact: true });
    await expect(cpu).toContainText("utilization unavailable");
    await expect(cpu.getByRole("progressbar")).toHaveCount(0);
  });
}

test("empty results and isolated read failures remain explicit", async ({ page }) => {
  await fixture(page, { empty: true });
  await expect(page.getByText("No nodes returned.", { exact: true })).toBeVisible();
  await expect(page.getByText("No warning events returned.", { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as Fixture).__clusterOverview.empty = false; (window as Fixture).__clusterOverview.failure = true; });
  await page.keyboard.press("ControlOrMeta+r");
  await expect(page.getByRole("region", { name: "Node condition warnings", exact: true }).getByRole("alert")).toBeVisible();
  await expect(page.getByRole("table", { name: "Latest warning events" })).toBeVisible();
});

test("pending reads are cancelled on navigation and late responses are ignored", async ({ page }) => {
  await fixture(page, { hold: true });
  await expect(page.getByRole("region", { name: "Node condition warnings", exact: true }).getByText("Loading nodes…", { exact: true })).toBeVisible();
  await page.goto("/#/cluster/one?section=storage");
  await expect.poll(() => page.evaluate(() => (window as Fixture).__clusterReads.filter(call => call.command === "cluster_resources_cancel" && call.kind === "nodes").length)).toBeGreaterThan(0);
  await page.evaluate(() => (window as Fixture).__releaseCluster());
  await expect(page.getByRole("region", { name: "CPU utilization", exact: true })).toHaveCount(0);
});
