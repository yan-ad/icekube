import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { resourceViews } from "../src/app/cluster/resourceViews";

type Call = { command: string; request: any };
type Control = { failDetail?: boolean; replaced?: boolean; deniedEvents?: boolean; version: number };
const pane = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });
const actions = (page: Page) => pane(page).getByRole("group", { name: "Resource actions", exact: true });

async function openAction(page: Page, name: string): Promise<Locator> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const direct = actions(page).getByRole("button", { name, exact: true });
  const trigger = await direct.isVisible() ? direct : actions(page).getByRole("button", { name: "More actions", exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("Enter");
  if (trigger !== direct) {
    const item = page.getByRole("menuitem", { name, exact: true });
    await expect(item).toBeEnabled();
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Home");
    for (let steps = 0; !await item.evaluate(element => element === document.activeElement) && steps < 10; steps++) await page.keyboard.press("ArrowDown");
    await expect(item).toBeFocused();
    await page.keyboard.press("Enter");
  }
  return trigger;
}

async function toolbarMeasurements(page: Page, width: number) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const more = actions(page).getByRole("button", { name: "More actions", exact: true });
  const compact = await more.isVisible();
  const labels = ["Scale", "Restart", "Edit YAML", "Delete resource"];
  const measurements = [];
  for (const label of compact ? ["More actions"] : labels) {
    const button = actions(page).getByRole("button", { name: label, exact: true });
    await expect(button).toHaveAccessibleName(label);
    await expect(button).toBeEnabled();
    await button.hover();
    await expect(page.getByRole("tooltip", { name: label, exact: true })).toBeVisible();
    const control = await button.boundingBox();
    const icon = await button.locator("svg").first().boundingBox();
    expect(control).not.toBeNull(); expect(icon).not.toBeNull();
    expect(control!.x).toBeGreaterThanOrEqual(0);
    expect(control!.x + control!.width).toBeLessThanOrEqual(width + 1);
    expect(control!.width).toBeGreaterThan(0); expect(control!.height).toBeGreaterThan(0);
    expect.soft(icon!.x, `${label}: icon left bound`).toBeGreaterThanOrEqual(control!.x - 1);
    expect.soft(icon!.y, `${label}: icon top bound`).toBeGreaterThanOrEqual(control!.y - 1);
    expect.soft(icon!.x + icon!.width, `${label}: icon right bound`).toBeLessThanOrEqual(control!.x + control!.width + 1);
    expect.soft(icon!.y + icon!.height, `${label}: icon bottom bound`).toBeLessThanOrEqual(control!.y + control!.height + 1);
    measurements.push({ label, control, icon });
  }
  const menuLabels = [];
  if (compact) {
    for (const label of labels) await expect(actions(page).getByRole("button", { name: label, exact: true })).toHaveCount(0);
    await more.focus(); await page.keyboard.press("Enter");
    for (const label of labels) {
      const item = page.getByRole("menuitem", { name: label, exact: true });
      await expect(item).toHaveAccessibleName(label);
      await expect(item).toBeEnabled();
      const measurement = await textBounds(item);
      expect(measurement.scrollWidth).toBeLessThanOrEqual(measurement.clientWidth + 1);
      expect(measurement.textBounds.x).toBeGreaterThanOrEqual(measurement.control.x - 1);
      expect(measurement.textBounds.right).toBeLessThanOrEqual(measurement.control.right + 1);
      expect(measurement.textBounds.bottom).toBeLessThanOrEqual(measurement.control.bottom + 1);
      expect(measurement.control.x).toBeGreaterThanOrEqual(0);
      expect(measurement.control.right).toBeLessThanOrEqual(width + 1);
      menuLabels.push({ label, ...measurement });
    }
    await noPageOverflow(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(more).toBeFocused();
  }
  await page.mouse.move(0, 0);
  return { compact, controls: measurements, menuLabels };
}

test("touch pane Close target is at least 44 CSS pixels at 390", async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 390, height: 800 }, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fixture(page, 390);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const close = pane(page).getByRole("button", { name: "Close inspector", exact: true });
    const target = await close.boundingBox();
    await writeFile(info.outputPath("measurements.json"), JSON.stringify({ hasTouch: true, target }, null, 2));
    await info.attach("touch-close-measurements", { body: JSON.stringify({ hasTouch: true, target }), contentType: "application/json" });
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
    await noPageOverflow(page);
    await close.tap();
    await expect(pane(page)).toHaveCount(0);
    expect(await calls(page, "cluster_workload_action")).toEqual([]);
    expect(await calls(page, "cluster_resource_delete")).toEqual([]);
  } finally { await context.close(); }
});
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
  await expect(pane(page).getByRole("button", { name: "Show managed fields", exact: true })).toBeVisible();
  await expect(actions(page).getByRole("button", { name: "Scale", exact: true })
    .or(actions(page).getByRole("button", { name: "More actions", exact: true }))).toBeEnabled();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth <= innerWidth, height: document.documentElement.scrollHeight <= innerHeight })) ).toEqual({ width: true, height: true });
}

async function textBounds(locator: ReturnType<Page["getByText"]>) {
  return locator.evaluate(element => {
    const leaf = [...element.querySelectorAll("*")].find(child => child.children.length === 0 && child.textContent?.trim()) ?? element;
    const rect = (value: DOMRect) => ({ x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom });
    const range = document.createRange(); range.selectNodeContents(leaf);
    const style = getComputedStyle(leaf);
    return { text: leaf.textContent, tag: leaf.tagName, scrollWidth: leaf.scrollWidth, clientWidth: leaf.clientWidth,
      leaf: rect(leaf.getBoundingClientRect()), textBounds: rect(range.getBoundingClientRect()), control: rect(element.getBoundingClientRect()),
      whiteSpace: style.whiteSpace, textOverflow: style.textOverflow, overflow: style.overflow };
  });
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
    const managedId = await disclosure.getAttribute("aria-controls");
    expect(managedId).toBeTruthy();
    const managed = page.locator(`[id=${JSON.stringify(managedId)}]`);
    await expect.soft(managed).toBeHidden();
    await disclosure.focus(); await page.keyboard.press("Enter");
    const hide = pane(page).getByRole("button", { name: "Hide managed fields", exact: true });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await expect(hide).toHaveAttribute("aria-controls", managedId!);
    await expect(managed).toBeVisible();
    await expect(pane(page)).toContainText("fixture-controller (Update)");
    const samples = [];
    for (const text of ["Some metadata is unavailable or redacted.", "Pods Status (returned subset, complete): Running: 1"]) {
      const sample = await measuredContrast(pane(page).getByText(text, { exact: true }));
      samples.push({ text, ...sample });
      expect(sample.ratio).toBeGreaterThanOrEqual(4.5);
    }
    const initialActions = await toolbarMeasurements(page, width);
    const scale = await openAction(page, "Scale");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Cluster: one. Namespace: team-a. Resource: deployments/sample-a. UID: deployments-sample-a-uid. Resource version: 1.");
    await dialog.getByRole("textbox", { name: "Replicas", exact: true }).fill("invalid");
    await expect(dialog).toContainText("Enter a whole number");
    await expect(dialog.getByRole("button", { name: "Confirm action", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(scale).toBeFocused();
    expect(await calls(page, "cluster_workload_action")).toEqual([]);
    const deletion = await openAction(page, "Delete resource");
    await expect(dialog.getByLabel("Deletion target")).toContainText("Cluster: Fixture cluster");
    await expect(dialog.getByRole("listitem")).toHaveText("team-a/sample-a");
    await expect(dialog.getByRole("button", { name: "Delete 1 resource", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(deletion).toBeEnabled();
    await expect(deletion).toBeFocused();
    expect(await calls(page, "cluster_resource_delete")).toEqual([]);
    const target = await close.boundingBox();
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await noPageOverflow(page);
    const enlargedActions = await toolbarMeasurements(page, width);
    const enlargedScale = await openAction(page, "Scale");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(enlargedScale).toBeFocused();
    expect(await calls(page, "cluster_workload_action")).toEqual([]);
    expect(await calls(page, "cluster_resource_delete")).toEqual([]);
    await noPageOverflow(page);
    const enlargedStatus = await textBounds(pane(page).getByText("Ready", { exact: true }).first());
    const enlargedNamespace = await textBounds(pane(page).getByText("Namespace", { exact: true }).first());
    const measurements = JSON.stringify({ width, theme, samples, closeTarget: target, rootFontSize: await page.locator("html").evaluate(element => getComputedStyle(element).fontSize), initialActions, enlargedActions, enlargedStatus, enlargedNamespace }, null, 2);
    await writeFile(info.outputPath("measurements.json"), measurements);
    await info.attach("audit-measurements", { body: measurements, contentType: "application/json" });
    expect(enlargedNamespace.scrollWidth).toBeLessThanOrEqual(enlargedNamespace.clientWidth + 1);
    expect(enlargedNamespace.textBounds.right).toBeLessThanOrEqual(enlargedNamespace.leaf.right + 1);
    expect(enlargedStatus.scrollWidth).toBeLessThanOrEqual(enlargedStatus.clientWidth + 1);
    expect(enlargedStatus.textBounds.right).toBeLessThanOrEqual(enlargedStatus.leaf.right + 1);
    expect(enlargedStatus.textBounds.bottom).toBeLessThanOrEqual(enlargedStatus.control.bottom + 1);
    await page.screenshot({ path: info.outputPath("pane-text-resize.png") });
    await expect(close).toBeInViewport();
    await hide.focus(); await page.keyboard.press("Space");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect.soft(managed).toBeHidden();
    await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
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
  await fixture(page);
  const trigger = await openAction(page, "Delete resource");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await calls(page, "cluster_resource_delete")).toEqual([]);
  expect(await calls(page, "cluster_workload_action")).toEqual([]);
});
