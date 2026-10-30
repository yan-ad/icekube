import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { NodeInfo } from "../src/app/cluster/nodeContract";
import type { DrainPod, DrainReview, DrainResult } from "../src/app/cluster/nodeDrainApi";

type Call = { command: string; request: any; response?: unknown };
type Control = {
  blocked?: boolean; partial?: boolean; holdExecute?: boolean; malformed?: boolean;
  prerequisite?: "get" | "patch" | "podList"; decision?: "denied" | "unknown";
  outcome?: DrainResult["state"];
};
type BrowserFixture = Window & { __drainCalls: Call[]; __drainUnexpected: string[]; __drainRelease: () => void };
const reference = { kind: "nodes", namespace: null, name: "worker", uid: "node-uid" } as const;
const pane = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });
const calls = (page: Page, command: string): Promise<Call[]> => page.evaluate(command =>
  (window as BrowserFixture).__drainCalls.filter(call => call.command === command), command);
const modal = (page: Page) => page.getByRole("dialog", { name: "Drain worker", exact: true });

async function fixture(page: Page, control: Control = {}, width = 1440) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(control => {
    const calls: Call[] = [], unexpected: string[] = [];
    let release = () => {}, cordoned = false, revision = "11";
    const node: NodeInfo = { roles: ["worker"], taints: 0, version: "v1.35.8", internalIps: ["192.0.2.10"], schedulable: true,
      conditions: [{ type: "Ready", status: "True" }], diskAllocatable: null,
      cpu: { used: null, allocatable: 4, capacity: 4 }, memory: { used: null, allocatable: 8192, capacity: 8192 }, metricsTimestamp: null };
    const reference = { kind: "nodes", namespace: null, name: "worker", uid: "node-uid" };
    const pods: DrainPod[] = [
      { name: "api", namespace: "team-a", uid: "api-uid", resourceVersion: "21", disposition: "evict", reason: "managed" },
      { name: "mirror", namespace: "kube-system", uid: "mirror-uid", resourceVersion: "22", disposition: "skip", reason: "mirror" },
      { name: "daemon", namespace: "kube-system", uid: "daemon-uid", resourceVersion: "23", disposition: "skip", reason: "daemonSet" },
      ...(control.blocked ? [
        { name: "orphan", namespace: "team-a", uid: "orphan-uid", resourceVersion: "24", disposition: "block" as const, reason: "unmanaged" as const },
        { name: "data", namespace: "team-b", uid: "data-uid", resourceVersion: "25", disposition: "block" as const, reason: "localData" as const },
      ] : []),
    ];
    const item = () => ({ name: "worker", namespace: null, uid: "node-uid", resourceVersion: revision,
      createdAt: "2026-10-01T00:00:00Z", status: "Ready", columns: {}, node: { ...node, schedulable: !cordoned } });
    Object.assign(window, { isTauri: true, __drainCalls: calls, __drainUnexpected: unexpected, __drainRelease: () => release(),
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, unregisterCallback() {}, invoke: async (command: string, args?: any) => {
        const request = structuredClone(args?.request ?? {});
        const call: Call = { command, request }; calls.push(call);
        const reply = (response: unknown) => { call.response = structuredClone(response); return response; };
        if (command === "plugin:event|listen") return 1;
        if (["plugin:event|unlisten", "cluster_permissions_cancel", "cluster_permissions_refresh", "cluster_resources_cancel", "cluster_namespace_cache_cancel", "cluster_resource_detail_cancel", "cluster_resource_collection_cancel", "cluster_node_drain_cancel", "cluster_disconnect"].includes(command)) return null;
        if (command === "cluster_permissions_review") return reply({ clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
          authorizationEpoch: "fixture", revision: 1, checkedAt: Date.now(), expiresAt: Date.now() + 30000,
          items: request.checks.map((check: any) => {
            const targeted = control.prerequisite === "podList" ? check.kind === "pods" && check.namespace === null && check.action === "list"
              : check.kind === "nodes" && check.name === "worker" && check.action === control.prerequisite;
            return { check, decision: targeted ? control.decision : "allowed", reason: null };
          }) });
        if (command === "catalog_list") return reply({ revision: 1, discoveryError: null, pinnedItems: [], clusters: ["one", "two"].map(id => ({
          id, name: `Synthetic ${id}`, contextName: "fixture", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, pinnedSections: [], status: "disconnected" })) });
        if (command === "catalog_connection_states") return [];
        if (command === "cluster_session_open" || command === "cluster_connect") return reply({ clusterId: request.clusterId, sessionId: request.sessionId ?? `lease-${request.clusterId}`,
          contextName: "fixture", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null });
        if (command === "cluster_namespace_cache_get" || command === "cluster_namespace_cache_refresh") {
          const fetchedAt = Date.now(); return reply({ clusterId: request.clusterId, sessionId: request.sessionId, names: ["team-a", "team-b"], fetchedAt, expiresAt: fetchedAt + 60000, partial: false });
        }
        if (command === "cluster_resources") return reply({ ...request, namespace: request.namespace ?? null,
          items: request.kind === "nodes" ? [item()] : [], continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: request.kind === "nodes" ? "unavailable" : null });
        if (command === "cluster_resource_detail") return reply({ ...request, reference, item: item(), related: {} });
        if (command === "cluster_resource_collection") return reply({ ...request, state: "complete", items: request.collection === "pods"
          ? pods.filter(pod => !cordoned || pod.disposition === "skip").map(pod => ({ reference: { kind: "pods", namespace: pod.namespace, name: pod.name, uid: pod.uid }, status: "Running", columns: { ready: "1/1", node: "worker" } }))
          : [{ reference: { kind: "events", namespace: "team-a", name: "node-event", uid: "event-uid" }, status: "Normal", columns: { type: "Normal", message: cordoned ? "Node cordoned" : "Node ready", reason: "NodeReady", count: "1", source: "kubelet", lastSeen: "2026-10-29T12:00:00Z" } }] });
        if (command === "cluster_node_drain_review") {
          const blocked = !!(control.blocked || control.partial);
          const review: DrainReview = { ...request, planId: blocked ? null : "a".repeat(32), expiresAt: blocked ? null : Date.now() + 120000,
            pods, canDrain: !blocked, partial: !!control.partial };
          return reply(control.malformed ? { ...review, extra: true } : review);
        }
        if (command === "cluster_node_drain_execute") {
          if (control.holdExecute) await new Promise<void>(resolve => { release = resolve; });
          cordoned = true; revision = "12";
          const result: DrainResult = { clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId, reference,
            cordoned: true, state: control.outcome ?? "complete", pods: pods.map(pod => ({ name: pod.name, namespace: pod.namespace, uid: pod.uid,
              state: pod.disposition === "skip" ? "skipped" : "evicted", reason: null })) };
          return reply(result);
        }
        unexpected.push(command); throw new Error(`Unexpected drain integration IPC: ${command}`);
      } } });
  }, control);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/#/cluster/one?section=nodes");
  await page.getByRole("table", { name: "Nodes", exact: true }).getByRole("button", { name: "worker", exact: true }).click();
  await expect(pane(page)).toBeVisible();
  if (control.prerequisite !== "get" || control.decision !== "denied") await expect(pane(page)).toContainText("node-uid");
  return errors;
}

async function action(page: Page, name: string): Promise<Locator> {
  const direct = pane(page).getByRole("button", { name, exact: true });
  const more = pane(page).getByRole("button", { name: "More actions", exact: true });
  await expect(direct.or(more)).toBeVisible();
  await expect(async () => {
    if (await direct.isVisible()) return;
    await more.click({ timeout: 1000 });
  }).toPass({ timeout: 5000 });
  return direct.or(page.getByRole("menuitem", { name, exact: true }));
}
async function review(page: Page) {
  await (await action(page, "Drain")).click();
  await expect(modal(page)).toBeVisible();
  expect(await calls(page, "cluster_node_drain_review")).toEqual([]);
  expect(await calls(page, "cluster_node_drain_execute")).toEqual([]);
  await modal(page).getByRole("button", { name: "Review drain", exact: true }).click();
}
async function confirm(page: Page) {
  await modal(page).getByRole("textbox", { name: "Confirm Node name", exact: true }).fill("worker");
  await modal(page).getByRole("button", { name: "Confirm drain", exact: true }).click();
}
async function safe(page: Page, errors: string[], executes = 0) {
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as BrowserFixture).__drainUnexpected)).toEqual([]);
  expect(await calls(page, "cluster_node_drain_execute")).toHaveLength(executes);
  expect(await calls(page, "cluster_node_action")).toEqual([]);
  const all = await page.evaluate(() => (window as BrowserFixture).__drainCalls);
  expect(all.filter(call => /kubectl|process|shell|exec|attach|forward|delete|patch|create|workload_action/.test(call.command)
    && call.command !== "cluster_node_drain_execute")).toEqual([]);
}

test("mounted Node pane uses exact review and execution contracts, retains report, then reloads Node and children", async ({ page }) => {
  const errors = await fixture(page);
  const detail = (await calls(page, "cluster_resource_detail")).at(-1)!;
  expect(detail.request).toEqual({ clusterId: "one", sessionId: "lease-one", readId: expect.any(Number), reference });
  expect(detail.response).toMatchObject({ item: { uid: "node-uid", resourceVersion: "11", node: { schedulable: true } } });
  await expect(pane(page).getByRole("table", { name: "Pods", exact: true })).toContainText("api");
  await expect(pane(page).getByRole("table", { name: "Events", exact: true })).toContainText("Node ready");
  const before = await calls(page, "cluster_resource_collection");
  const detailCount = (await calls(page, "cluster_resource_detail")).length;
  await review(page);
  const dialog = modal(page);
  for (const text of ["evict: Managed Pod", "skip: Mirror Pod remains", "skip: DaemonSet Pod remains"]) await expect(dialog).toContainText(text);
  const reviewed = (await calls(page, "cluster_node_drain_review"))[0];
  expect(reviewed.request).toEqual({ clusterId: "one", sessionId: "lease-one", operationId: expect.any(Number), reference, resourceVersion: "11" });
  expect(reviewed.response).toMatchObject({ canDrain: true, partial: false, pods: [expect.objectContaining({ uid: "api-uid", disposition: "evict" }), expect.objectContaining({ uid: "mirror-uid", disposition: "skip" }), expect.objectContaining({ uid: "daemon-uid", disposition: "skip" })] });
  await expect(dialog.getByRole("button", { name: "Confirm drain", exact: true })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Confirm Node name", exact: true }).fill("Worker");
  await expect(dialog.getByRole("button", { name: "Confirm drain", exact: true })).toBeDisabled();
  await confirm(page);
  await expect(dialog).toContainText("Drain result: complete. Node cordoned: yes.");
  await expect(dialog).toContainText("Name: api. evicted.");
  await expect(dialog).toContainText("Name: mirror. skipped.");
  await expect(dialog).toContainText("not certification");
  await expect(dialog.getByRole("button", { name: "Confirm drain", exact: true })).toHaveCount(0);
  const execution = (await calls(page, "cluster_node_drain_execute"))[0];
  expect(execution.request).toEqual({ clusterId: "one", sessionId: "lease-one", operationId: expect.any(Number), planId: "a".repeat(32) });
  expect(execution.request.operationId).not.toBe(reviewed.request.operationId);
  expect(execution.response).toMatchObject({ reference, cordoned: true, state: "complete" });
  expect(await calls(page, "cluster_resource_detail")).toHaveLength(detailCount);
  expect(await calls(page, "cluster_resource_collection")).toHaveLength(before.length);
  const checks = (await calls(page, "cluster_permissions_review")).flatMap(call => call.request.checks);
  for (const check of [{ kind: "nodes", namespace: null, name: "worker", action: "get" }, { kind: "nodes", namespace: null, name: "worker", action: "patch" }, { kind: "pods", namespace: null, name: null, action: "list" }]) expect(checks).toContainEqual(check);
  expect(checks.some(check => check.action === "evict")).toBe(false);
  await dialog.getByRole("button", { name: "Close and reload details", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await calls(page, "cluster_resource_detail")).length).toBeGreaterThan(detailCount);
  await expect(pane(page)).toContainText("12");
  await expect(pane(page).getByRole("table", { name: "Events", exact: true })).toContainText("Node cordoned");
  await expect(pane(page).getByRole("table", { name: "Pods", exact: true }).getByRole("button", { name: "api", exact: true })).toHaveCount(0);
  const rereads = (await calls(page, "cluster_resource_collection")).slice(before.length);
  expect(new Set(rereads.map(call => call.request.collection))).toEqual(new Set(["pods", "events"]));
  for (const call of rereads) {
    expect(call.request).toEqual({ clusterId: "one", sessionId: "lease-one", readId: expect.any(Number), reference, collection: expect.stringMatching(/^(pods|events)$/) });
    expect(before.some(old => old.request.readId === call.request.readId)).toBe(false);
  }
  expect((await calls(page, "cluster_resource_detail")).at(-1)?.response).toMatchObject({ item: { uid: "node-uid", resourceVersion: "12", node: { schedulable: false } } });
  await expect(await action(page, "Uncordon")).toBeEnabled();
  await safe(page, errors, 1);
});

for (const state of ["blocked", "partial"] as const) test(`${state} review is read-only and cannot confirm from the full pane`, async ({ page }) => {
  const errors = await fixture(page, { [state]: true }); await review(page);
  await expect(modal(page)).toContainText(state === "partial" ? "Incomplete inventory" : "Drain is blocked");
  if (state === "blocked") for (const text of ["block: Unmanaged Pod", "block: Local data", "skip: Mirror Pod remains", "skip: DaemonSet Pod remains"]) await expect(modal(page)).toContainText(text);
  await expect(modal(page).getByRole("button", { name: "Confirm drain", exact: true })).toBeDisabled();
  await expect(modal(page).getByRole("textbox", { name: "Confirm Node name", exact: true })).toHaveCount(0);
  await modal(page).getByRole("button", { name: "Cancel", exact: true }).click();
  const read = (await calls(page, "cluster_node_drain_review"))[0].request;
  expect((await calls(page, "cluster_node_drain_cancel"))[0].request).toEqual({ clusterId: read.clusterId, sessionId: read.sessionId, operationId: read.operationId });
  await safe(page, errors);
});

for (const prerequisite of ["patch", "podList"] as const) for (const decision of ["denied", "unknown"] as const) test(`${decision} ${prerequisite} disables Drain without hiding readable Node details`, async ({ page }) => {
  const errors = await fixture(page, { prerequisite, decision });
  await expect(pane(page)).toContainText("Drain requires verified Node get and patch access and cluster-wide Pod list access.");
  await expect(await action(page, "Drain")).toBeDisabled();
  expect(await calls(page, "cluster_node_drain_review")).toEqual([]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await safe(page, errors);
});

for (const decision of ["denied", "unknown"] as const) test(`${decision} Node get never offers a usable drain action`, async ({ page }) => {
  const errors = await fixture(page, { prerequisite: "get", decision });
  if (decision === "denied") {
    await expect(pane(page)).toContainText(/permission|denied/i);
    expect(await calls(page, "cluster_resource_detail")).toEqual([]);
    await expect(pane(page).getByRole("button", { name: "Drain", exact: true })).toHaveCount(0);
    await expect(pane(page).getByRole("button", { name: "More actions", exact: true })).toHaveCount(0);
  } else await expect(await action(page, "Drain")).toBeDisabled();
  expect(await calls(page, "cluster_node_drain_review")).toEqual([]);
  await safe(page, errors);
});

for (const destination of ["catalog", "session"] as const) test(`${destination} disposal cancels exact active execution and ignores its late report`, async ({ page }) => {
  const errors = await fixture(page, { holdExecute: true }); await review(page); await confirm(page);
  await expect(page.getByRole("alertdialog")).toContainText("Draining Node");
  const execution = (await calls(page, "cluster_node_drain_execute"))[0].request;
  await page.evaluate(destination => { location.hash = destination === "catalog" ? "/catalog/clusters" : "/cluster/two?section=nodes"; }, destination);
  await expect.poll(async () => (await calls(page, "cluster_node_drain_cancel")).length).toBe(1);
  expect((await calls(page, "cluster_node_drain_cancel"))[0].request).toEqual({ clusterId: "one", sessionId: "lease-one", operationId: execution.operationId });
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  const details = (await calls(page, "cluster_resource_detail")).length;
  await page.evaluate(() => (window as BrowserFixture).__drainRelease());
  await expect.poll(async () => (await calls(page, "cluster_node_drain_execute"))[0].response).toMatchObject({ state: "complete" });
  await expect(page.getByText("Drain result: complete.", { exact: false })).toHaveCount(0);
  expect(await calls(page, "cluster_resource_detail")).toHaveLength(details);
  await safe(page, errors, 1);
});

for (const outcome of ["blocked", "partial", "cancelled", "timeout", "uncertain"] as const) test(`${outcome} report stays visible without repeat writes or implicit reload`, async ({ page }) => {
  const errors = await fixture(page, { outcome }); await review(page);
  const before = (await calls(page, "cluster_resource_detail")).length;
  await confirm(page); await expect(modal(page)).toContainText(`Drain result: ${outcome}`);
  await expect(modal(page)).toContainText("Do not replay this plan");
  await expect(modal(page).getByRole("button", { name: "Confirm drain", exact: true })).toHaveCount(0);
  expect(await calls(page, "cluster_resource_detail")).toHaveLength(before);
  await safe(page, errors, 1);
});

test("390-wide keyboard overflow opens Drain, cancel restores More and modal fits viewport", async ({ page }) => {
  const errors = await fixture(page, {}, 390);
  const more = pane(page).getByRole("button", { name: "More actions", exact: true });
  await expect(more).toBeVisible(); await more.focus(); await page.keyboard.press("Enter");
  const drain = page.getByRole("menuitem", { name: "Drain", exact: true });
  await expect(drain).toBeEnabled(); await drain.focus(); await page.keyboard.press("Enter");
  const dialog = modal(page); await expect(dialog).toBeVisible();
  expect(await calls(page, "cluster_node_drain_review")).toEqual([]);
  await dialog.getByRole("button", { name: "Review drain", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("textbox", { name: "Confirm Node name", exact: true })).toBeVisible();
  expect(await dialog.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth; })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0); await expect(more).toBeFocused();
  const reviewed = (await calls(page, "cluster_node_drain_review"))[0].request;
  expect((await calls(page, "cluster_node_drain_cancel"))[0].request).toEqual({ clusterId: "one", sessionId: "lease-one", operationId: reviewed.operationId });
  await safe(page, errors);
});

test("mounted pane rejects malformed review rather than bypassing its closed transport parser", async ({ page }) => {
  const errors = await fixture(page, { malformed: true }); await review(page);
  await expect(modal(page).getByRole("alert")).toContainText("Reload details");
  await expect(modal(page).getByRole("button", { name: "Confirm drain", exact: true })).toBeDisabled();
  await safe(page, errors);
});

test("native and development dispatchers route all drain commands to the same Rust owner", () => {
  const native = readFileSync("src-tauri/src/lib.rs", "utf8");
  const development = readFileSync("src-tauri/src/dev_engine.rs", "utf8");
  const adapter = readFileSync("src/app/cluster/nodeDrainApi.ts", "utf8");
  const inspector = readFileSync("src/app/cluster/ResourceInspector.tsx", "utf8");
  for (const phase of ["review", "execute", "cancel"]) {
    const command = `cluster_node_drain_${phase}`, method = `node_drain_${phase}`;
    expect(native).toContain(command);
    expect(native).toMatch(new RegExp(`fn ${command}\\([\\s\\S]*?engine\\.${method}\\(request\\)`));
    expect(native.slice(native.indexOf("tauri::generate_handler!"))).toContain(command);
    expect(development).toMatch(new RegExp(`"${command}" => \\{[\\s\\S]*?state\\.connections\\.${method}\\(request\\)`));
    expect(adapter).toContain(`invoke("${command}"`);
  }
  expect(inspector).toContain("<NodeDrain clusterId={clusterId} sessionId={sessionId} detail={detail}");
  expect(inspector).toContain("<NodeActions clusterId={clusterId} sessionId={sessionId} detail={detail}");
  expect(adapter).not.toMatch(/kubectl|child_process|window\.open|fetch\(/);
});
