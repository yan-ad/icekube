import { expect, test, type Page } from "@playwright/test";
import { resourceViews } from "../src/app/cluster/resourceViews";

type Call = { command: string; request: any };
type Control = { failDetail?: boolean; replaced?: boolean; deniedEvents?: boolean; version: number };
const pane = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });
const calls = (page: Page, command: string): Promise<Call[]> => page.evaluate(command => (window as any).__paneCalls.filter((call: Call) => call.command === command), command);
const control = (page: Page, value: Partial<Control>) => page.evaluate(value => Object.assign((window as any).__paneControl, value), value);

async function fixture(page: Page) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(views => {
    const calls: Call[] = [];
    const state: Control = { version: 1 };
    const item = (kind: string, name: string) => ({ name, namespace: views.find(view => view.kind === kind)?.namespaced ? "team-a" : null, uid: `${kind}-${name}-uid`, resourceVersion: String(state.version),
      createdAt: "2026-10-01T00:00:00Z", status: "Ready", node: null,
      columns: Object.fromEntries((views.find(view => view.kind === kind)?.columns ?? []).map(column => [column.key, column.key === "replicas" ? "2" : "1"])) });
    Object.assign(window, { isTauri: true, __paneCalls: calls, __paneControl: state,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, unregisterCallback() {}, invoke: async (command: string, args?: any) => {
      const request = structuredClone(args?.request ?? {}); calls.push({ command, request });
      if (command === "plugin:event|listen") return 1;
      if (command === "plugin:event|unlisten" || command.endsWith("_cancel") || command === "cluster_permissions_refresh" || command === "cluster_disconnect") return null;
      if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, authorizationEpoch: "fixture", revision: 1,
        checkedAt: Date.now(), expiresAt: Date.now() + 30000, items: request.checks.map((check: any) => ({ check, decision: "allowed", reason: null })) };
      if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], pinnedItems: [], clusters: [{ id: "one", name: "Fixture cluster", contextName: "fixture", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, pinnedSections: [], status: "disconnected" }] };
      if (command === "catalog_connection_states") return [];
      if (command === "cluster_namespace_cache_get" || command === "cluster_namespace_cache_refresh") {
        const fetchedAt = Date.now();
        return { clusterId: request.clusterId, sessionId: request.sessionId, names: ["team-a"], fetchedAt, expiresAt: fetchedAt + 60_000, partial: false };
      }
      if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: request.clusterId, sessionId: request.sessionId ?? "pane-lease", contextName: "fixture", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
      if (command === "cluster_resources") return { ...request, namespace: request.namespace ?? null, items: [item(request.kind, "sample-a")], continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null };
      if (command === "helm_table") return { ...request, items: [], truncated: false };
      if (command === "cluster_resource_detail") {
        if (state.failDetail) throw "connectionFailed";
        if (state.replaced) throw "conflict";
        const result = item(request.reference.kind, request.reference.name);
        result.uid = request.reference.uid ?? result.uid;
        if (request.reference.kind === "replicaSets") result.columns.controlledBy = "owner-deployment";
        return { ...request, reference: { ...request.reference, uid: result.uid }, item: result,
          related: request.reference.kind === "replicaSets" ? { controlledBy: { kind: "deployments", namespace: "team-a", name: "owner-deployment", uid: "owner-uid" } } : {},
          metadata: { labels: [{ key: "app", value: "fixture-api" }], annotations: [{ key: "example/note", value: "safe metadata" }], finalizers: ["example/cleanup"], deletionTimestamp: null, partial: true,
            managedFields: [{ manager: "fixture-controller", operation: "Update", apiVersion: "apps/v1", time: "2026-10-29T12:00:00Z", subresource: null, fields: '[["spec","replicas"]]' }] } };
      }
      if (command === "cluster_resource_collection") {
        const columns = request.collection === "pods" ? { ready: "1/1", node: "node-a", restarts: "0", qos: "Burstable", health: "healthy", warning: "" }
          : request.collection === "replicaSets" ? { ready: "2", replicas: "2", desired: "3" }
          : { type: "Normal", reason: "ScalingReplicaSet", message: "Scaled fixture replica set", source: "deployment-controller", count: "2", lastSeen: "2026-10-29T12:00:00Z" };
        const denied = request.collection === "events" && state.deniedEvents;
        return { ...request, state: denied ? "denied" : "complete", items: denied ? [] : [{ reference: { kind: request.collection, namespace: "team-a", name: `${request.collection.toLowerCase()}-child`, uid: `${request.collection}-uid` }, status: request.collection === "pods" ? "Running" : "Ready", columns }] };
      }
      if (command === "cluster_workload_action") { state.version++; return { clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId, reference: request.reference, action: request.action, accepted: true, created: null }; }
      throw new Error(`Unexpected pane fixture command: ${command}`);
    } } });
  }, resourceViews);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/cluster/one?section=deployments");
  await page.getByRole("table", { name: "Deployments", exact: true }).getByRole("button", { name: "sample-a", exact: true }).click();
  await expect(pane(page).getByRole("button", { name: "Scale", exact: true })).toBeEnabled();
}

test("full inspector composes safe metadata, managed fields, projected collection columns and exact owner navigation", async ({ page }) => {
  await fixture(page);
  await expect(pane(page)).toContainText("fixture-api");
  await expect(pane(page)).toContainText("safe metadata");
  await expect(pane(page)).toContainText("Some metadata is unavailable or redacted.");
  await expect(pane(page).getByText('[["spec","replicas"]]', { exact: true })).toHaveCount(0);
  await pane(page).getByRole("button", { name: "Show managed fields", exact: true }).click();
  await expect(pane(page)).toContainText("fixture-controller (Update)");
  await expect(pane(page)).toContainText('[["spec","replicas"]]');
  await expect(pane(page).getByRole("table", { name: "Pods", exact: true })).toContainText("node-a");
  await expect(pane(page).getByRole("table", { name: "Replica Sets", exact: true })).toContainText("3");
  await expect(pane(page).getByRole("table", { name: "Events", exact: true })).toContainText("Scaled fixture replica set");
  await pane(page).getByRole("button", { name: "replicasets-child", exact: true }).click();
  await expect(pane(page).getByRole("button", { name: "owner-deployment", exact: true })).toBeVisible();
  expect((await calls(page, "cluster_resource_detail")).at(-1)?.request.reference).toEqual({ kind: "replicaSets", namespace: "team-a", name: "replicasets-child", uid: "replicaSets-uid" });
  await pane(page).getByRole("button", { name: "owner-deployment", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_resource_detail")).at(-1)?.request.reference).toEqual({ kind: "deployments", namespace: "team-a", name: "owner-deployment", uid: "owner-uid" });
});

test("accepted Scale reloads detail and each collection while a denied collection stays independent", async ({ page }) => {
  await fixture(page);
  await expect(pane(page).getByRole("table")).toHaveCount(3);
  const before = await calls(page, "cluster_resource_collection");
  const details = await calls(page, "cluster_resource_detail");
  await control(page, { deniedEvents: true });
  await pane(page).getByRole("button", { name: "Scale", exact: true }).click();
  await page.getByRole("textbox", { name: "Replicas", exact: true }).fill("3");
  await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_resource_detail")).length).toBeGreaterThan(details.length);
  await expect.poll(async () => (await calls(page, "cluster_resource_collection")).length).toBeGreaterThan(before.length);
  await expect(pane(page)).toContainText("Permission denied for this related collection.");
  await expect(pane(page).getByRole("table")).toHaveCount(2);
  const after = (await calls(page, "cluster_resource_collection")).slice(before.length);
  expect(new Set(after.map(call => call.request.collection))).toEqual(new Set(["pods", "replicaSets", "events"]));
  expect(after.every(call => call.request.reference.uid === "deployments-sample-a-uid" && !before.some(old => old.request.readId === call.request.readId))).toBe(true);
  expect((await calls(page, "cluster_workload_action"))[0].request).toMatchObject({ action: "scale", replicas: 3, resourceVersion: "1", reference: { uid: "deployments-sample-a-uid" } });
});

test("failed or UID-replaced refresh retains honest stale detail without enabling another mutation", async ({ page }) => {
  await fixture(page);
  await control(page, { failDetail: true });
  await pane(page).getByRole("button", { name: "Refresh details", exact: true }).click();
  await expect(pane(page)).toContainText("Retained details may be stale.");
  await expect(pane(page).getByRole("button", { name: "Scale", exact: true })).toHaveCount(0);
  await control(page, { failDetail: false, replaced: true });
  await pane(page).getByRole("button", { name: "Refresh details", exact: true }).click();
  await expect(pane(page)).toContainText("This resource was replaced.");
  await expect(pane(page).getByRole("button", { name: "Scale", exact: true })).toHaveCount(0);
  expect(await calls(page, "cluster_workload_action")).toEqual([]);
});
