import { expect, test, type Page } from "@playwright/test";
import { resourceViews } from "../src/app/cluster/resourceViews";

type Request = Record<string, any>;
type Call = { command: string; request: Request };
type Menu = Request & { clusterId: string; sessionId: string; requestId: string; actions: string[] };
type Controls = { readFailure?: boolean; replacement?: boolean; missing?: boolean; holdShow?: boolean; holdListen?: boolean; showFailure?: boolean; removeAccepted?: boolean };
type FixtureWindow = Window & {
  __rowCalls: Call[]; __rowControls: Controls; __rowUnexpected: string[];
  __rowEmit: (payload: Request, late?: boolean) => void; __rowRelease: () => void;
  __rowListeners: () => number; __rowOrder: string[];
};
const registry = [{ section: "nodes", kind: "nodes", namespaced: false, label: "Nodes" }, ...resourceViews.filter(view => view.kind)];
const calls = (page: Page, command: string) => page.evaluate(command => (window as FixtureWindow).__rowCalls.filter(call => call.command === command), command);
const control = (page: Page, value: Controls) => page.evaluate(value => Object.assign((window as FixtureWindow).__rowControls, value), value);
const inspector = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });
const dialog = (page: Page) => page.getByRole("dialog");
async function fixture(page: Page, section: string) {
  await page.addInitScript(({ registry }) => {
    const calls: Call[] = [], unexpected: string[] = [], order: string[] = [], pending: (() => void)[] = [];
    const controls: Controls = {};
    const removed = new Set<string>();
    const callbacks = new Map<number, (value: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const retired: { id: number; event: string; handler: number }[] = [];
    let next = 0, session = 0;
    const namespaced = new Set(registry.filter(view => view.namespaced).map(view => view.kind));
    const usage = { used: null, capacity: null, allocatable: null };
    const item = (name: string, namespace: string | null, kind: string) => ({ name, namespace,
      uid: controls.missing ? null : `${name}-${controls.replacement ? "replacement" : "uid"}`, resourceVersion: "11", status: "Running", createdAt: null, columns: {},
      node: kind === "nodes" ? { roles: [], taints: 0, version: null, internalIps: [], schedulable: true, diskAllocatable: null, metricsTimestamp: null, cpu: usage, memory: usage, conditions: [] } : null });
    const emit = (payload: Request, late = false) => {
      const entries = late ? retired : [...listeners].map(([id, value]) => ({ id, ...value }));
      for (const { id, event, handler } of entries) if (event === "iceon://row-context-menu") callbacks.get(handler)?.({ event, id, payload });
    };
    Object.assign(window, { isTauri: true, __rowCalls: calls, __rowControls: controls, __rowUnexpected: unexpected, __rowOrder: order,
      __rowEmit: emit, __rowRelease: () => { controls.holdShow = false; controls.holdListen = false; pending.splice(0).forEach(resolve => resolve()); },
      __rowListeners: () => [...listeners.values()].filter(value => value.event === "iceon://row-context-menu").length,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => {
        const listener = listeners.get(id); if (listener) retired.push({ id, ...listener }); listeners.delete(id);
      } },
      __TAURI_INTERNALS__: {
        transformCallback: (callback: (value: unknown) => void) => { const id = ++next; callbacks.set(id, callback); return id; },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (command: string, args?: Request) => {
          const r = { ...args?.request }; calls.push({ command, request: r }); order.push(command);
          if (command === "cluster_permissions_cancel") return null;
          if (command === "cluster_permissions_review") {
            const request = args!.request as import("../src/app/cluster/permissionsApi").PermissionReviewRequest;
            return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, authorizationEpoch: `fixture-epoch-${request.sessionId}`, revision: request.readId, checkedAt: Date.now(), expiresAt: Date.now() + 30000, items: request.checks.map(check => ({ check, decision: "allowed", reason: null })) };
          }
          if (command === "plugin:event|listen") {
            if (controls.holdListen) await new Promise<void>(resolve => pending.push(resolve));
            const id = ++next; listeners.set(id, { event: args!.event, handler: args!.handler }); return id;
          }
          if (command === "cluster_custom_resource_definitions_cancel") return null;
          if (command === "cluster_custom_resource_definitions") return { ...r, kind: "customResourceDefinitions", namespace: null,
            items: [],
            continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null };
          if (command === "plugin:event|unlisten") { listeners.delete(args!.eventId); return null; }
          if (command === "row_context_menu_show") {
            if (controls.holdShow) await new Promise<void>(resolve => pending.push(resolve));
            if (controls.showFailure) throw "synthetic-private-diagnostic";
            return null;
          }
          if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
            { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
          ] };
          if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: r.clusterId, sessionId: r.sessionId ?? `lease-${++session}`,
            contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: "v1.35.8", error: null };
          if (command === "cluster_resources") {
            if (controls.readFailure) throw "permissionDenied";
            const namespace = namespaced.has(r.kind) ? r.namespace ?? "team-a" : null;
            return { ...r, namespace: r.namespace ?? null, items: ["alpha", "beta"].filter(name => !removed.has(`${r.kind}/${name}`)).map(name => item(name, namespace, r.kind)),
              continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null };
          }
          if (command === "cluster_resource_detail") return { ...r, item: item(r.reference.name, r.reference.namespace, r.reference.kind), related: {}, sections: [] };
          if (command === "cluster_pod_detail") return { ...r, uid: `${r.name}-uid`, resourceVersion: "11", phase: "Running", node: null, podIps: [], hostIps: [], serviceAccount: null,
            qos: null, createdAt: null, deletionTimestamp: null, containers: [], conditions: [], yaml: "apiVersion: v1\nkind: Pod\n", events: [] };
          if (command === "cluster_resource_delete") {
            if (controls.removeAccepted) removed.add(`${r.kind}/${r.name}`);
            return { ...r, accepted: true, deleted: false };
          }
          if (command === "helm_table") return { ...r, truncated: false, items: ["alpha", "beta"].map(name => ({ id: `cached-${name}`, name: r.view === "charts" ? `stable/${name}` : name,
            namespace: r.view === "charts" ? null : "team-a", version: name === "alpha" ? "1.2.3" : "2.0.0", appVersion: "4", description: r.view === "charts" ? `Metadata for ${name}` : null, status: r.view === "charts" ? null : "deployed", revision: r.view === "charts" ? null : 3, updated: r.view === "charts" ? null : "2026-10-26" })) };
          if (command === "helm_install") return { clusterId: r.clusterId, sessionId: r.sessionId, namespace: r.namespace, releaseName: r.releaseName, chart: r.chart, created: !r.dryRun };
          if (command === "cluster_pod_forward_list") return ["running", "stopped", "error"].map((status, index) => ({ ...r, id: `forward-${status}`, namespace: "team-a", name: `pod-${index}`, remotePort: 8080 + index, localPort: 18080 + index, status, error: status === "error" ? "connectionFailed" : null }));
          if (["row_context_menu_cancel", "cluster_disconnect", "cluster_resources_cancel", "cluster_resource_detail_cancel", "cluster_resource_delete_cancel", "cluster_pod_detail_cancel", "helm_cancel", "helm_install_cancel", "cluster_pod_forward_stop"].includes(command)) return null;
          unexpected.push(command); throw "Unexpected synthetic IPC";
        },
      },
    });
  }, { registry });
  await page.setViewportSize({ width: 1563, height: 1000 });
  await page.goto(`/#/cluster/one?section=${section}`);
  await expect(page.getByRole("button", { name: /Actions for/ }).first()).toBeVisible();
}
async function openMenu(page: Page, name: string, gesture: "right" | "keyboard" | "button" = "right"): Promise<Menu> {
  const trigger = page.getByRole("button", { name: `Actions for ${name}`, exact: true });
  const row = trigger.locator("xpath=ancestor::tr");
  const count = (await calls(page, "row_context_menu_show")).length;
  if (gesture === "keyboard") { await row.focus(); await page.keyboard.press("Shift+F10"); }
  else if (gesture === "button") await trigger.click();
  else await row.click({ button: "right" });
  await expect.poll(async () => (await calls(page, "row_context_menu_show")).length).toBe(count + 1);
  await expect(page.getByRole("menu")).toHaveCount(0);
  return (await calls(page, "row_context_menu_show")).at(-1)!.request as Menu;
}
async function select(page: Page, menu: Menu, action: string | null, late = false, extra: Request = {}) {
  await page.evaluate(({ menu, action, late, extra }) => (window as FixtureWindow).__rowEmit({ clusterId: menu.clusterId, sessionId: menu.sessionId, requestId: menu.requestId, action, ...extra }, late), { menu, action, late, extra });
}
async function noListener(page: Page) { await expect.poll(() => page.evaluate(() => (window as FixtureWindow).__rowListeners())).toBe(0); }
async function clusterAction(page: Page, name: string) {
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
test.afterEach(async ({ page }) => { expect(await page.evaluate(() => (window as FixtureWindow).__rowUnexpected ?? [])).toEqual([]); });

for (const view of registry) test(`${view.kind}: real right-click details and Shift+F10 deletion target the row, not selection`, async ({ page }) => {
  await fixture(page, view.section);
  const namespace = view.namespaced ? "team-a" : null;
  const selected = page.getByRole("checkbox", { name: `Select ${namespace ? "team-a/" : ""}beta`, exact: true });
  await selected.check();
  const menu = await openMenu(page, "alpha");
  expect(menu).toMatchObject({ clusterId: "one", sessionId: expect.stringMatching(/^lease-/), target: { type: "resource", reference: { kind: view.kind, name: "alpha", namespace, uid: "alpha-uid" } } });
  expect(menu.actions).toEqual(view.kind === "pods" ? ["details", "edit", "logs", "shell", "attach", "forward", "delete"] : ["details", "delete"]);
  expect(await calls(page, "cluster_resource_detail")).toEqual([]);
  expect(await calls(page, "cluster_pod_detail")).toEqual([]);
  await select(page, menu, "details");
  await expect(inspector(page)).toContainText("alpha");
  const command = view.kind === "pods" ? "cluster_pod_detail" : "cluster_resource_detail";
  await expect.poll(async () => (await calls(page, command)).length).toBeGreaterThan(0);
  expect((await calls(page, command)).at(-1)!.request).toMatchObject(view.kind === "pods" ? { clusterId: "one", sessionId: menu.sessionId, name: "alpha", namespace, uid: "alpha-uid" } : { clusterId: "one", sessionId: menu.sessionId, reference: menu.target.reference });
  await expect(selected).toBeChecked();
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  const deletion = await openMenu(page, "alpha", "keyboard");
  await select(page, deletion, "delete");
  await expect(dialog(page).getByRole("listitem")).toHaveText([`${namespace ? "team-a/" : ""}alpha`]);
  expect(await calls(page, "cluster_resource_delete")).toEqual([]);
  await dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_resource_delete")).length).toBe(1);
  expect((await calls(page, "cluster_resource_delete")).map(call => call.request)).toEqual([{ clusterId: "one", sessionId: menu.sessionId, kind: view.kind, namespace, name: "alpha", uid: "alpha-uid", resourceVersion: "11", readId: expect.any(Number) }]);
  await select(page, deletion, "delete", true);
  expect(await calls(page, "cluster_resource_delete")).toHaveLength(1);
  await noListener(page);
});

for (const section of ["nodes", "config-maps"]) for (const removeAccepted of [false, true]) test(`${section}: accepted deletion keeps results through refresh${removeAccepted ? " and row removal" : " with the row retained"}`, async ({ page }) => {
  await fixture(page, section); await control(page, { removeAccepted });
  const menu = await openMenu(page, "alpha"); await select(page, menu, "delete");
  await expect(dialog(page).getByRole("listitem")).toHaveText([section === "nodes" ? "alpha" : "team-a/alpha"]);
  const reads = (await calls(page, "cluster_resources")).length;
  await dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_resources")).length).toBeGreaterThan(reads);
  const beta = page.getByRole("checkbox", { name: `Select ${section === "nodes" ? "" : "team-a/"}beta`, exact: true });
  await expect(beta).toBeEnabled();
  await expect(page.getByRole("button", { name: "Actions for alpha", exact: true })).toHaveCount(removeAccepted ? 0 : 1);
  await expect(dialog(page).getByLabel("Deletion results")).toContainText("1 accepted or deleted; 0 failed");
  await expect(dialog(page)).toContainText("Deletion accepted; grace periods or finalizers may still apply.");
  await expect(dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true })).toHaveCount(0);
  const refreshedReads = (await calls(page, "cluster_resources")).length;
  await page.keyboard.press("ControlOrMeta+r");
  await expect.poll(async () => (await calls(page, "cluster_resources")).length).toBeGreaterThan(refreshedReads);
  await expect(beta).toBeEnabled();
  await expect(dialog(page).getByLabel("Deletion results")).toContainText("1 accepted or deleted; 0 failed");
  expect(await calls(page, "cluster_resource_delete")).toHaveLength(1);
  await dialog(page).getByRole("button", { name: "Close", exact: true }).filter({ hasText: /^Close$/ }).click();
  await expect(dialog(page)).toHaveCount(0);
  const next = await openMenu(page, removeAccepted ? "beta" : "alpha", "keyboard"); await select(page, next, "delete");
  await expect(dialog(page).getByRole("listitem")).toHaveText([`${section === "nodes" ? "" : "team-a/"}${removeAccepted ? "beta" : "alpha"}`]);
  await expect(dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true })).toBeEnabled();
  expect(await calls(page, "cluster_resource_delete")).toHaveLength(1);
  await page.keyboard.press("Escape"); await expect(dialog(page)).toHaveCount(0);
});

for (const change of ["replacement", "stale"] as const) test(`${change}: refresh invalidates an unsubmitted context confirmation without reopening`, async ({ page }) => {
  await fixture(page, "config-maps");
  const menu = await openMenu(page, "alpha"); await select(page, menu, "delete");
  await expect(dialog(page).getByRole("listitem")).toHaveText(["team-a/alpha"]);
  await control(page, change === "replacement" ? { replacement: true } : { readFailure: true });
  await page.keyboard.press("ControlOrMeta+r");
  await expect(dialog(page)).toHaveCount(0);
  if (change === "stale") {
    await expect(page.getByRole("alert")).toContainText("Kubernetes permissions");
    await expect(page.getByRole("status").filter({ hasText: "Updates unavailable" })).toContainText("stale");
  }
  await control(page, { readFailure: false });
  await page.getByRole("button", { name: "Refresh config-maps", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Select team-a/alpha", exact: true })).toBeEnabled();
  await expect(dialog(page)).toHaveCount(0);
  expect(await calls(page, "cluster_resource_delete")).toEqual([]);
  const next = await openMenu(page, "alpha"); await select(page, next, "delete");
  await expect(dialog(page).getByRole("listitem")).toHaveText(["team-a/alpha"]);
  expect(await calls(page, "cluster_resource_delete")).toEqual([]);
  await page.keyboard.press("Escape");
});

for (const view of ["charts", "releases"] as const) test(`Helm ${view}: both gestures preserve exact metadata and implemented actions`, async ({ page }) => {
  await fixture(page, `helm-${view}`);
  const name = view === "charts" ? "stable/alpha" : "alpha";
  const menu = await openMenu(page, name);
  expect(menu.target).toEqual(view === "charts" ? { type: "helmChart", id: "cached-alpha", name } : { type: "helmRelease", name, namespace: "team-a" });
  expect(menu.actions).toEqual(view === "charts" ? ["details", "install"] : ["details"]);
  await select(page, menu, "details");
  await expect(inspector(page)).toContainText(name);
  await expect(inspector(page)).toContainText("1.2.3");
  await expect(inspector(page)).not.toContainText("Metadata for beta");
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  const keyboard = await openMenu(page, name, "keyboard");
  if (view === "releases") {
    await select(page, keyboard, "delete"); await expect(inspector(page)).toHaveCount(0); await select(page, keyboard, "details"); await expect(inspector(page)).toContainText(name);
  }
  else {
    await select(page, keyboard, "install");
    await expect(dialog(page).getByRole("textbox", { name: "Chart repository/name", exact: true })).toHaveValue(name);
    await expect(dialog(page).getByRole("textbox", { name: "Chart version (optional)", exact: true })).toHaveValue("1.2.3");
    expect(await calls(page, "helm_install")).toEqual([]);
    await dialog(page).getByRole("button", { name: /^Namespace/ }).click();
    await page.getByRole("option", { name: "alpha", exact: true }).click();
    await dialog(page).getByRole("textbox", { name: "Release name", exact: true }).fill("chosen-release");
    await dialog(page).getByRole("button", { name: "Run server dry-run", exact: true }).click();
    await expect(dialog(page)).toContainText("Server dry-run passed");
    expect((await calls(page, "helm_install")).map(call => call.request.dryRun)).toEqual([true]);
    await dialog(page).getByRole("button", { name: "Install release", exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await calls(page, "helm_install")).map(call => call.request)).toEqual([true, false].map(dryRun => ({ clusterId: "one", sessionId: menu.sessionId, namespace: "alpha", releaseName: "chosen-release", chart: name, version: "1.2.3", valuesYaml: "{}\n", dryRun, readId: expect.any(Number) })));
  }
  expect(await calls(page, "cluster_resource_detail")).toEqual([]);
  await noListener(page);
});

for (const status of ["running", "stopped", "error"]) test(`forward ${status}: details and ${status === "running" ? "stop" : "remove"} never use a neighboring forward`, async ({ page }) => {
  await fixture(page, "port-forwarding");
  const id = `forward-${status}`, action = status === "running" ? "stop" : "remove";
  const menu = await openMenu(page, id);
  expect(menu.target).toEqual({ type: "forward", id }); expect(menu.actions).toEqual(["details", action]);
  await select(page, menu, "details");
  await expect(inspector(page)).toContainText(id);
  await expect(inspector(page)).toContainText(`pod-${["running", "stopped", "error"].indexOf(status)}`);
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  const keyboard = await openMenu(page, id, "keyboard"); await select(page, keyboard, action);
  await expect.poll(async () => (await calls(page, "cluster_pod_forward_stop")).length).toBe(1);
  expect((await calls(page, "cluster_pod_forward_stop"))[0].request).toEqual({ clusterId: "one", sessionId: menu.sessionId, id });
  await noListener(page);
});

test("replacement menu, malformed scope, dismissal and retired callback cannot act", async ({ page }) => {
  await fixture(page, "config-maps");
  const first = await openMenu(page, "alpha"), second = await openMenu(page, "beta", "button");
  expect(first.requestId).not.toBe(second.requestId);
  await select(page, first, "details", true);
  for (const extra of [{ sessionId: "stale" }, { clusterId: "other" }, { requestId: first.requestId }, { arbitrary: "command" }]) await select(page, second, "details", false, extra);
  await select(page, second, "install");
  await expect(inspector(page)).toHaveCount(0);
  await select(page, second, "details"); await expect(inspector(page)).toContainText("beta");
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  const dismissed = await openMenu(page, "alpha"); await select(page, dismissed, null); await noListener(page);
  await select(page, dismissed, "delete", true); await expect(dialog(page)).toHaveCount(0);
  expect(await calls(page, "cluster_resource_delete")).toEqual([]);
  const order = await page.evaluate(() => (window as FixtureWindow).__rowOrder);
  expect(order.indexOf("plugin:event|listen")).toBeLessThan(order.indexOf("row_context_menu_show"));
});

for (const change of ["stale", "replacement", "filter", "route", "session"] as const) test(`${change} invalidates root ownership before late native selection`, async ({ page }) => {
  await fixture(page, "config-maps"); const menu = await openMenu(page, "alpha");
  if (change === "stale" || change === "replacement") { await control(page, change === "stale" ? { readFailure: true } : { replacement: true }); await page.keyboard.press("ControlOrMeta+r"); }
  if (change === "filter") await page.getByRole("textbox", { name: "Search Config Maps", exact: true }).fill("beta");
  if (change === "route") await page.evaluate(() => { location.hash = "/cluster/one?section=services"; });
  if (change === "session") { await clusterAction(page, "Disconnect"); await clusterAction(page, "Connect to cluster"); }
  await noListener(page);
  expect((await calls(page, "row_context_menu_cancel")).some(call => call.request.requestId === menu.requestId)).toBe(true);
  await select(page, menu, "details", true); await select(page, menu, "delete", true);
  await expect(inspector(page)).toHaveCount(0); await expect(dialog(page)).toHaveCount(0);
  expect(await calls(page, "cluster_resource_delete")).toEqual([]);
  if (change === "stale") { const stale = await openMenu(page, "alpha"); expect(stale.actions).toEqual(["details"]); await select(page, stale, null); }
});

test("missing UID disables mutating Pod actions but retains Details", async ({ page }) => {
  await fixture(page, "pods"); await control(page, { missing: true }); await page.keyboard.press("ControlOrMeta+r");
  await expect(page.getByRole("checkbox", { name: "Select team-a/alpha", exact: true })).toBeDisabled();
  const menu = await openMenu(page, "alpha", "keyboard"); expect(menu.actions).toEqual(["details"]);
  await select(page, menu, "delete"); await expect(dialog(page)).toHaveCount(0); await select(page, menu, null);
});

for (const hold of ["holdListen", "holdShow"] as const) test(`${hold}: unmount during asynchronous setup disposes late completion`, async ({ page }) => {
  await fixture(page, "config-maps"); await control(page, { [hold]: true });
  if (hold === "holdShow") await openMenu(page, "alpha");
  else { await page.getByRole("button", { name: "Actions for alpha", exact: true }).click(); await expect.poll(async () => (await calls(page, "plugin:event|listen")).length).toBeGreaterThan(0); }
  await page.evaluate(() => { location.hash = "/cluster/one?section=services"; });
  await expect(page.getByRole("table", { name: "Services", exact: true })).toBeVisible();
  await page.evaluate(() => (window as FixtureWindow).__rowRelease()); await noListener(page);
  const shown = await calls(page, "row_context_menu_show");
  if (hold === "holdListen") expect(shown).toHaveLength(0);
  else { await select(page, shown[0].request as Menu, "delete", true); expect(await calls(page, "row_context_menu_cancel")).not.toHaveLength(0); }
  await expect(dialog(page)).toHaveCount(0);
});

test("30-second expiry releases listener and ignores a retained callback", async ({ page }) => {
  await fixture(page, "config-maps"); await page.clock.install(); await page.clock.pauseAt(new Date());
  const menu = await openMenu(page, "alpha");
  await page.clock.fastForward(29_999); await expect.poll(() => page.evaluate(() => (window as FixtureWindow).__rowListeners())).toBe(1);
  await page.clock.fastForward(1); await noListener(page);
  await select(page, menu, "delete", true); await expect(dialog(page)).toHaveCount(0);
  expect((await calls(page, "row_context_menu_cancel")).map(call => call.request)).toContainEqual({ clusterId: menu.clusterId, sessionId: menu.sessionId, requestId: menu.requestId });
});

test("native popup failure is sanitized and can be retried", async ({ page }) => {
  await fixture(page, "config-maps"); await control(page, { showFailure: true }); await openMenu(page, "alpha");
  await expect(page.getByRole("alert")).toContainText("Could not open row actions. Try again.");
  await expect(page.getByRole("alert")).not.toContainText("synthetic-private"); await noListener(page);
  await control(page, { showFailure: false }); const menu = await openMenu(page, "beta", "keyboard");
  await select(page, menu, "details"); await expect(inspector(page)).toContainText("beta");
});
