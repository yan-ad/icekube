import { expect, test, type Page } from "@playwright/test";

type Request = Record<string, unknown>;
type Call = { command: string; request: Request };
type Controls = { missingRelation?: boolean; denied?: boolean; unknown?: boolean; hold?: boolean; failure?: boolean };
type Fixture = Window & { __paneCalls: Call[]; __paneControl: Controls; __paneRelease: () => void };
const calls = (page: Page) => page.evaluate(() => (window as Fixture).__paneCalls);
const details = async (page: Page) => (await calls(page)).filter(call => call.command === "cluster_resource_detail").map(call => call.request.reference);
const eventReference = { kind: "events", namespace: "team-b", name: "warning-one", uid: "uid-warning-one" };
const targetReference = { kind: "deployments", namespace: "team-b", name: "affected", uid: "uid-affected" };

async function fixture(page: Page, workloads = false, control: Controls = {}) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(control => {
    const calls: Call[] = [], pending: (() => void)[] = [];
    const item = (name: string, namespace: string | null, columns: Record<string, string> = {}) => ({ name, namespace, uid: `uid-${name}`, resourceVersion: "1", status: "Warning", columns, createdAt: "2026-10-01T00:00:00Z", node: null });
    const event = item("warning-one", "team-b", { type: "Warning", message: "Scheduling warning", involvedObject: "Deployment/affected", count: "2" });
    const node = { ...item("node-one", null), node: { roles: [], taints: 0, version: "v1.35.8", internalIps: [], schedulable: true,
      conditions: [{ type: "Ready", status: "True" }, { type: "MemoryPressure", status: "True" }, { type: "DiskPressure", status: "False" }], diskAllocatable: null,
      cpu: { used: 1, allocatable: 4, capacity: 4 }, memory: { used: 1, allocatable: 4, capacity: 4 }, metricsTimestamp: "2026-10-27T00:00:00Z" } };
    Object.assign(window, { isTauri: true, __paneCalls: calls, __paneControl: control, __paneRelease: () => pending.splice(0).forEach(resolve => resolve()),
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} }, __TAURI_INTERNALS__: {
        transformCallback: () => 1, unregisterCallback() {},
        invoke: async (command: string, args?: { request?: Request }) => {
          const request = structuredClone(args?.request ?? {}); calls.push({ command, request });
          if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
            authorizationEpoch: String(request.sessionId), revision: 0, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
            items: (request.checks as Request[]).map(check => ({ check, decision: check.action === "get" && control.denied ? "denied" : check.action === "get" && control.unknown ? "unknown" : "allowed", reason: null })) };
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten" || command.endsWith("_cancel") || command === "cluster_disconnect" || command === "cluster_permissions_refresh") return null;
          if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
          if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: request.clusterId, sessionId: request.sessionId ?? "pane-lease", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
          if (command === "cluster_resource_detail") {
            if (control.unknown) throw "permissionDenied";
            const reference = request.reference as { kind: string; name: string; namespace: string | null };
            const row = reference.kind === "events" ? event : reference.kind === "nodes" ? node : item(reference.name, reference.namespace, { desired: "1", ready: "0" });
            return { ...request, item: row, related: reference.kind === "events" && !control.missingRelation ? { involvedObject: { kind: "deployments", namespace: "team-b", name: "affected", uid: "uid-affected" } } : {} };
          }
          if (command === "cluster_resources") {
            if (request.kind === "pods" && control.hold) await new Promise<void>(resolve => pending.push(resolve));
            if (request.kind === "pods" && control.failure) throw "permissionDenied";
            const items = request.kind === "events" ? [event] : request.kind === "nodes" ? [node] : request.kind === "namespaces" ? [item("team-a", null), item("team-b", null)] : [];
            return { ...request, namespace: request.namespace ?? null, items, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: request.kind === "nodes" ? "available" : null };
          }
          throw "invalidInput";
        },
      },
    });
  }, control);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/#/cluster/one${workloads ? "?section=workloads-overview" : ""}`);
  await expect(page.getByRole("table", { name: workloads ? "Latest events" : "Latest warning events", exact: true })).toBeVisible();
}

async function readOnly(page: Page) {
  expect((await calls(page)).filter(call => /delete|mutat|create|patch|exec|attach|forward|shell/.test(call.command))).toEqual([]);
}

test("Cluster Message resolves the current Event relationship and opens its affected object", async ({ page }) => {
  await fixture(page);
  const message = page.getByRole("button", { name: "Scheduling warning", exact: true });
  await message.focus(); await page.keyboard.press("Enter");
  await expect.poll(() => details(page)).toEqual([eventReference, targetReference]);
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toContainText("affected");
  await readOnly(page);
});

test("Workloads Message opens Event itself; nested object button resolves target independently", async ({ page }) => {
  await fixture(page, true);
  const message = page.getByRole("button", { name: "Scheduling warning", exact: true });
  await message.focus(); await page.keyboard.press("Space");
  await expect.poll(() => details(page)).toEqual([eventReference]);
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toContainText("warning-one");
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  await page.getByRole("table", { name: "Latest events", exact: true }).getByRole("button", { name: "Deployment/affected", exact: true }).click();
  await expect.poll(() => details(page)).toEqual([eventReference, eventReference, targetReference]);
  await readOnly(page);
});

test("missing relationship does not fabricate affected-object details", async ({ page }) => {
  await fixture(page, false, { missingRelation: true });
  await page.getByRole("button", { name: "Scheduling warning", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toContainText("no longer available");
  expect(await details(page)).toEqual([eventReference]);
  await readOnly(page);
});

for (const access of ["denied", "unknown"] as const) test(`${access} Event GET never becomes fake detail content`, async ({ page }) => {
  await fixture(page, true, { [access]: true });
  await page.getByRole("button", { name: "Scheduling warning", exact: true }).click();
  const pane = page.getByRole("region", { name: "Resource details", exact: true });
  await expect(pane).toContainText(access === "denied" ? /denied|permission/i : /unverified/i);
  if (access === "denied") expect(await details(page)).toEqual([]);
  else {
    await expect(pane).toContainText(/Kubernetes permissions/);
    expect(await details(page)).toEqual([eventReference]);
  }
  await expect(pane.getByText("Only reviewed inventory metadata", { exact: false })).toHaveCount(0);
  await readOnly(page);
});

test("namespace cell changes Workloads request scope without opening Namespace details", async ({ page }) => {
  await fixture(page, true);
  await page.getByRole("button", { name: "Filter workloads to namespace team-b", exact: true }).click();
  await expect.poll(async () => (await calls(page)).filter(call => call.command === "cluster_resources" && call.request.kind === "events").at(-1)?.request.namespace).toBe("team-b");
  expect(await details(page)).toEqual([]);
  await expect(page).toHaveURL(/section=workloads-overview/);
  await readOnly(page);
});

test("retained Workloads show refresh progress, then stale failure without hiding counts", async ({ page }) => {
  await fixture(page, true);
  await page.evaluate(() => { (window as Fixture).__paneControl.hold = true; });
  await page.keyboard.press("ControlOrMeta+r");
  await expect(page.getByRole("progressbar", { name: "Refreshing workloads overview…", exact: true })).toBeVisible();
  const pods = page.getByRole("region", { name: "Pods inventory", exact: true });
  await expect(pods).toContainText("Refreshing Pods… Retained data is stale.");
  await expect(pods.getByRole("img")).toHaveAccessibleName("Pods: 0 loaded");
  await page.evaluate(() => { (window as Fixture).__paneControl.failure = true; (window as Fixture).__paneControl.hold = false; (window as Fixture).__paneRelease(); });
  await expect(pods.getByRole("alert")).toContainText("Retained data is stale");
  await expect(page.getByRole("progressbar", { name: "Refreshing workloads overview…", exact: true })).toHaveCount(0);
  await readOnly(page);
});

test("loaded active Node warning conditions open Node, not Event or synthetic condition details", async ({ page }) => {
  await fixture(page);
  const table = page.getByRole("table", { name: "Node condition warnings", exact: true });
  await expect(table).not.toContainText("DiskPressure");
  await expect(page.getByText(/Active warning conditions in the loaded node snapshot: 1/)).toBeVisible();
  await table.getByRole("button", { name: "MemoryPressure: True", exact: true }).click();
  await expect.poll(() => details(page)).toEqual([{ kind: "nodes", namespace: null, name: "node-one", uid: "uid-node-one" }]);
  await readOnly(page);
});
