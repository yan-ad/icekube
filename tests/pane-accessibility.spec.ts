import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { resourceViews } from "../src/app/cluster/resourceViews";

type Call = { command: string; request: any };
type Control = { failDetail?: boolean; replaced?: boolean; deniedEvents?: boolean; version: number };
const pane = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });
const calls = (page: Page, command: string): Promise<Call[]> => page.evaluate(command => (window as any).__paneCalls.filter((call: Call) => call.command === command), command);
const control = (page: Page, value: Partial<Control>) => page.evaluate(value => Object.assign((window as any).__paneControl, value), value);

async function fixture(page: Page, width = 1440) {
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
        if (request.reference.kind === "events") return { ...request, reference: { ...request.reference, uid: result.uid }, item: result, related: {}, eventDiagnostic: { message: "Fixture scheduling message\n" + "bounded diagnostic ".repeat(70), truncated: false, source: "fixture-controller", fieldPath: "spec.replicas" } };
        if (request.reference.kind === "replicaSets") result.columns.controlledBy = "owner-deployment";
        return { ...request, reference: { ...request.reference, uid: result.uid }, item: result,
          related: request.reference.kind === "replicaSets" ? { controlledBy: { kind: "deployments", namespace: "team-a", name: "owner-deployment", uid: "owner-uid" } } : {},
          metadata: { labels: [{ key: "app", value: "fixture-api" }], annotations: [{ key: "example/note", value: "a".repeat(600) }, { key: "example/long-note", value: "b".repeat(600) }], finalizers: ["example/cleanup"], deletionTimestamp: null, partial: true,
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
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/#/cluster/one?section=deployments");
  await page.getByRole("table", { name: "Deployments", exact: true }).getByRole("button", { name: "sample-a", exact: true }).click();
  await expect(pane(page).getByRole("button", { name: "Scale", exact: true })).toBeEnabled();
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth <= innerWidth, height: document.documentElement.scrollHeight <= innerHeight })) ).toEqual({ width: true, height: true });
}

async function measuredContrast(locator: ReturnType<Page["getByText"]>) {
  return locator.evaluate(element => {
    const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const foreground = channels(getComputedStyle(element).color);
    let background = [255, 255, 255];
    for (let current: Element | null = element; current; current = current.parentElement) {
      const color = channels(getComputedStyle(current).backgroundColor);
      if (color.length === 3 || color[3] === 1) { background = color; break; }
      if (color[3] && color[3] !== 1) throw new Error("Translucent background requires compositing");
    }
    if (foreground.length === 4 && foreground[3] !== 1) throw new Error("Translucent text requires compositing");
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const a = luminance(foreground), b = luminance(background);
    return { foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  });
}

for (const width of [390, 800, 1440]) for (const theme of ["light", "dark"] as const) {
  test(`pane reflow, disclosure, keyboard, confirmation and measured labels at ${width} ${theme}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await fixture(page, width);
    await noPageOverflow(page);
    await expect(pane(page)).toHaveCSS("transition-duration", "0s");
    const close = pane(page).getByRole("button", { name: "Close inspector", exact: true });
    await expect(close).toBeInViewport();
    const body = pane(page).locator(".resource-inspector-body");
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const disclosure = pane(page).getByRole("button", { name: "Show managed fields", exact: true });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await disclosure.focus(); await page.keyboard.press("Enter");
    const hide = pane(page).getByRole("button", { name: "Hide managed fields", exact: true });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await expect(pane(page)).toContainText("fixture-controller (Update)");
    const samples = [];
    for (const text of ["Some metadata is unavailable or redacted.", "Pods Status (returned subset, complete): Running: 1"]) {
      const sample = await measuredContrast(pane(page).getByText(text, { exact: true }));
      samples.push({ text, ...sample });
      expect(sample.ratio).toBeGreaterThanOrEqual(4.5);
    }
    const scale = pane(page).getByRole("button", { name: "Scale", exact: true });
    await scale.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Cluster: one. Namespace: team-a. Resource: deployments/sample-a. UID: deployments-sample-a-uid. Resource version: 1.");
    await dialog.getByRole("textbox", { name: "Replicas", exact: true }).fill("invalid");
    await expect(dialog).toContainText("Enter a whole number");
    await expect(dialog.getByRole("button", { name: "Confirm action", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(scale).toBeFocused();
    const deletion = pane(page).getByRole("button", { name: "Delete resource", exact: true });
    await deletion.focus(); await page.keyboard.press("Enter");
    await expect(dialog.getByLabel("Deletion target")).toContainText("Cluster: Fixture cluster");
    await expect(dialog.getByRole("listitem")).toHaveText("team-a/sample-a");
    await expect(dialog.getByRole("button", { name: "Delete 1 resource", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(deletion).toBeEnabled();
    expect(await calls(page, "cluster_resource_delete")).toEqual([]);
    const target = await close.boundingBox();
    const measurements = JSON.stringify({ width, theme, samples, closeTarget: target }, null, 2);
    await writeFile(info.outputPath("measurements.json"), measurements);
    await info.attach("audit-measurements", { body: measurements, contentType: "application/json" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await noPageOverflow(page);
    await page.screenshot({ path: info.outputPath("pane-text-resize.png") });
    await expect(close).toBeInViewport();
    await hide.focus(); await page.keyboard.press("Space");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(close).toBeInViewport();
    await close.focus(); await page.keyboard.press("Enter");
    await expect(pane(page)).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Deployments", exact: true }).getByRole("button", { name: "sample-a", exact: true })).toBeFocused();
    expect(await calls(page, "cluster_workload_action")).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("related event message activates by keyboard and closes without a stale trigger", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  const message = pane(page).getByRole("button", { name: "Scaled fixture replica set", exact: true });
  await message.focus(); await page.keyboard.press("Enter");
  await expect(pane(page).getByRole("heading", { name: "Cluster diagnostic text", exact: true })).toBeVisible();
  await expect.poll(async () => (await calls(page, "cluster_resource_detail")).at(-1)?.request.reference.kind).toBe("events");
  await expect(pane(page)).toContainText("Recognizable credential syntax is redacted, not all sensitive data.");
  const close = pane(page).getByRole("button", { name: "Close inspector", exact: true });
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(pane(page)).toHaveCount(0);
  expect(await calls(page, "cluster_workload_action")).toEqual([]);
});

test("delete confirmation restores keyboard focus to its pane trigger", async ({ page }) => {
  test.fail(true, "Known audit defect: Delete resource is disabled while its dialog opens, so automatic trigger capture loses the focus target.");
  await fixture(page);
  const trigger = pane(page).getByRole("button", { name: "Delete resource", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
