import { expect, test, type Page } from "@playwright/test";
import { resourceCreation, resourceViews } from "../src/app/cluster/resourceViews";

type Request = Record<string, string | number | boolean | null>;
type Call = { command: string; request: Request };
type Controls = { hold?: boolean; holdName?: string; failure?: string; failName?: string; readFailure?: boolean; syncStatus?: "stopped" | "retrying"; malformed?: string; deleted?: boolean; replacement?: boolean; missing?: boolean; paginated?: boolean };
type MockWindow = Window & { __deleteCalls: Call[]; __deleteControl: Controls; __releaseDelete: () => void; __deleteUnexpected: string[]; __deleteActive: number; __deleteMaxActive: number };
const registry = [{ section: "nodes", kind: "nodes", namespaced: false }, ...resourceViews.filter(view => view.kind)].map(view => ({ section: view.section, kind: view.kind!, namespaced: view.namespaced }));
const calls = (page: Page, command = "cluster_resource_delete") => page.evaluate(command => (window as MockWindow).__deleteCalls.filter(call => call.command === command), command);
const controls = (page: Page, value: Controls) => page.evaluate(value => Object.assign((window as MockWindow).__deleteControl, value), value);
const release = (page: Page) => page.evaluate(() => (window as MockWindow).__releaseDelete());
const remove = (page: Page) => page.getByRole("button", { name: "Delete selected resources", exact: true });
const dialog = (page: Page) => page.getByRole("dialog");
const all = (page: Page) => page.getByRole("checkbox", { name: "Select all rows", exact: true });
const row = (page: Page, name = "alpha", namespace: string | null = "team-a") => page.getByRole("checkbox", { name: `Select ${namespace ? `${namespace}/` : ""}${name}`, exact: true });
const cancelScope = ({ clusterId, sessionId, kind, readId }: Request) => ({ clusterId, sessionId, kind, readId });
async function clusterAction(page: Page, name: string) {
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function namespace(page: Page, name: string) {
  await expect(page.getByRole("status", { name: "Loading namespaces…", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^Namespace(?:\s|$)/ }).click();
  await page.getByRole("option", { name, exact: true }).click();
}
async function fixture(page: Page, section = "config-maps", options: Controls = {}) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(({ section, options, registry }) => {
    const calls: Call[] = [], unexpected: string[] = [], pending: (() => void)[] = [];
    const control = { ...options };
    let session = 0, syncRequest: Request = {}, sequence = 0;
    const namespaced = new Set(registry.filter(view => view.namespaced).map(view => view.kind));
    const item = (name: string, namespace: string | null, i: number) => ({ name, namespace, uid: control.missing && i === 2 ? null : `${name}-${control.replacement && i === 0 ? "replacement" : "uid"}`,
      resourceVersion: control.missing && i === 3 ? null : `${i + 11}`, status: "Running", createdAt: null, columns: {}, node: null });
    const inventory = (r: Request, live = false) => {
      const discovery = r.kind === "namespaces" && section !== "namespaces";
      let items = discovery ? ["team-a", "team-b"].map((name, i) => item(name, null, i)) :
        ["alpha", "beta", ...(control.missing ? ["no-uid", "no-version"] : [])].map((name, i) => item(name, namespaced.has(String(r.kind)) ? String(r.namespace ?? "team-a") : null, i));
      if (r.query) items = items.filter(item => item.name.includes(String(r.query)));
      if (control.paginated && !discovery) items = r.continueToken ? [item("gamma", namespaced.has(String(r.kind)) ? String(r.namespace ?? "team-a") : null, 2)] : items;
      const more = !!control.paginated && !discovery && !r.continueToken && !live;
      return { ...r, namespace: r.namespace ?? null, items, continueToken: more ? "page-two" : null, truncated: more, fetchedAt: Date.now(), metrics: null };
    };
    Object.assign(window, { isTauri: true, __deleteCalls: calls, __deleteControl: control, __deleteUnexpected: unexpected, __deleteActive: 0, __deleteMaxActive: 0,
      __releaseDelete: () => { control.hold = false; pending.splice(0).forEach(resolve => resolve()); },
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Request }) => {
        const r = { ...args?.request }; calls.push({ command, request: r });
        if (command === "catalog_connection_states") return [];
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "update_state") return { phase: "idle", version: null, error: null };
        if (command === "preferences_get") return null;
        if (command === "cluster_custom_resource_definitions_cancel") return null;
        if (command === "cluster_custom_resource_definitions") return { ...r, kind: "customResourceDefinitions", namespace: null,
          items: [],
          continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: r.clusterId, sessionId: r.sessionId ?? `lease-${++session}`, contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        if (["cluster_disconnect", "cluster_resources_cancel", "cluster_resource_delete_cancel", "cluster_pod_detail_cancel", "cluster_pod_sync_close"].includes(command)) return null;
        if (command === "cluster_resources") { if (control.readFailure) throw "permissionDenied"; return inventory(r); }
        if (command === "cluster_pod_sync_open") { syncRequest = r; return { ...r, syncId: "sync-one", sequence: ++sequence, status: "syncing", error: null, page: inventory(r, true) }; }
        if (command === "cluster_pod_sync_read") return { ...r, sequence: ++sequence, status: control.syncStatus ?? "syncing", error: null, page: control.syncStatus ? null : inventory(syncRequest, true) };
        if (command === "cluster_pod_detail") return { ...r, uid: "alpha-uid", resourceVersion: "11", phase: "Running", node: null, podIps: [], hostIps: [], serviceAccount: null,
          qos: null, createdAt: null, deletionTimestamp: null, containers: [], conditions: [], yaml: "", events: [] };
        if (command === "cluster_resource_delete") {
          const options = { ...control }, w = window as MockWindow;
          w.__deleteActive++; w.__deleteMaxActive = Math.max(w.__deleteMaxActive, w.__deleteActive);
          try {
            if (options.hold && (!options.holdName || options.holdName === r.name)) await new Promise<void>(resolve => pending.push(resolve));
            if (options.failure && (!options.failName || options.failName === r.name)) throw options.failure;
            if (options.malformed === "null") return null;
            if (options.malformed === "array") return [];
            const result: Record<string, unknown> = { ...r, deleted: !!options.deleted, accepted: !options.deleted };
            if (options.malformed === "flags") result.deleted = result.accepted;
            else if (options.malformed === "missingAccepted") delete result.accepted;
            else if (options.malformed) result[options.malformed] = "wrong";
            return result;
          } finally { w.__deleteActive--; }
        }
        unexpected.push(command); throw `Unexpected synthetic IPC: ${command}`;
      } },
    });
  }, { section, options, registry });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/cluster/one?section=${section}`);
  await expect(all(page)).toBeEnabled();
  await expect(remove(page)).toHaveCount(0);
}
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as MockWindow).__deleteUnexpected ?? [])).toEqual([]);
});

test("registry exercises every resource kind, including nodes, and excludes service placeholders", () => {
  expect(registry.map(view => view.kind).sort()).toEqual(Object.keys(resourceCreation).sort());
});
for (const { section, kind, namespaced } of registry) test(`${kind}: selected identity is confirmed and sent exactly once`, async ({ page }) => {
  await fixture(page, section);
  const ns = namespaced ? "team-a" : null;
  await row(page, "alpha", ns).check(); await remove(page).click();
  await expect(dialog(page)).toContainText(`Delete 1 ${resourceCreation[kind as keyof typeof resourceCreation].kind} resource?`);
  await expect(dialog(page).getByLabel("Deletion target")).toHaveText("Cluster: DevelopmentCluster ID: oneContext: dev");
  await expect(dialog(page).getByRole("listitem")).toHaveText([`${ns ? `${ns}/` : ""}alpha`]);
  expect(await calls(page)).toEqual([]);
  await dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true }).click();
  await expect(dialog(page)).toContainText("1 accepted or deleted; 0 failed");
  await expect(page.getByRole("group", { name: "Resource actions", exact: true }).getByRole("button", { name: "Delete selected resources", exact: true })).toHaveCount(0);
  await expect(dialog(page).getByLabel("Deletion results")).toContainText("alpha:");
  const requests = await calls(page);
  expect(requests).toHaveLength(1);
  expect(requests[0].request).toEqual({ clusterId: "one", sessionId: expect.stringMatching(/^lease-/), kind, readId: expect.any(Number), name: "alpha", namespace: ns, uid: "alpha-uid", resourceVersion: "11" });
  expect(Number.isSafeInteger(requests[0].request.readId)).toBe(true);
  expect(requests[0].request.readId).toBeGreaterThan(0);
});

test("individual, indeterminate, select-all, deselect and keyboard clear exclude missing identities", async ({ page }) => {
  await fixture(page, "config-maps", { missing: true });
  await expect(row(page, "no-uid")).toBeDisabled(); await expect(row(page, "no-version")).toBeDisabled();
  await row(page).focus(); await page.keyboard.press("Space");
  await expect(remove(page)).toBeVisible();
  await expect(row(page)).toBeChecked(); await expect(all(page)).toBeChecked({ indeterminate: true });
  await expect(page.getByRole("status").filter({ hasText: /^1 selected$/ })).toBeVisible();
  await all(page).check(); await expect(row(page, "beta")).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: /^2 selected$/ })).toBeVisible();
  await row(page).uncheck(); await expect(all(page)).toBeChecked({ indeterminate: true });
  await page.getByRole("button", { name: "Clear selection", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(remove(page)).toHaveCount(0); await expect(row(page, "beta")).not.toBeChecked();
  await all(page).focus(); await page.keyboard.press("Space"); await expect(row(page)).toBeChecked();
  await page.keyboard.press("Space"); await expect(remove(page)).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
});

test("failed refresh invalidates an open confirmation before any deletion", async ({ page }) => {
  await fixture(page); await row(page).check(); await remove(page).click();
  await controls(page, { readFailure: true });
  await page.keyboard.press("ControlOrMeta+r");
  await expect(dialog(page)).toHaveCount(0);
  await expect(remove(page)).toBeDisabled(); await expect(row(page)).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Inventory changed or became unavailable" })).toBeVisible();
  expect(await calls(page)).toEqual([]);
});

for (const syncStatus of ["retrying", "stopped"] as const) test(`${syncStatus} live inventory disables selection and invalidates confirmation`, async ({ page }) => {
  await fixture(page, "pods"); await row(page).check();
  await clusterAction(page, "Enable live sync");
  await expect(row(page)).toBeEnabled(); await expect(row(page)).not.toBeChecked();
  await row(page).check(); await remove(page).click();
  await controls(page, { syncStatus });
  await expect(dialog(page)).toHaveCount(0);
  await expect(row(page)).toBeDisabled(); await expect(remove(page)).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: `Live sync: ${syncStatus}` })).toBeVisible();
  expect(await calls(page)).toEqual([]);
});

for (const failed of [false, true]) test(`stopping after a known ${failed ? "failure" : "acceptance"} preserves results and unsubmitted selection`, async ({ page }) => {
  await fixture(page, "config-maps", { hold: true, holdName: "beta", ...(failed ? { failure: "conflict", failName: "alpha" } : {}) });
  await all(page).check(); await remove(page).click();
  await dialog(page).getByRole("button", { name: "Delete 2 resources", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  await expect(dialog(page).getByLabel("Deletion results")).toContainText(`team-a/alpha: ${failed ? "Resource changed" : "Deletion accepted"}`);
  await dialog(page).getByRole("button", { name: "Stop deleting", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(row(page)).toBeChecked({ checked: failed });
  await expect(row(page, "beta")).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: `team-a/alpha: ${failed ? "Resource changed" : "Deletion accepted"}` })).toContainText("Stopping does not undo it");
  const requests = await calls(page);
  expect((await calls(page, "cluster_resource_delete_cancel")).map(call => call.request)).toEqual([cancelScope(requests[1].request)]);
  await release(page); await page.waitForTimeout(150);
  await expect(row(page)).toBeChecked({ checked: failed }); await expect(row(page, "beta")).toBeChecked();
});

test("inventory becoming stale stops the active delete and prevents queued submissions", async ({ page }) => {
  await fixture(page, "pods", { hold: true }); await clusterAction(page, "Enable live sync");
  await expect(row(page)).toBeEnabled(); await all(page).check(); await remove(page).click();
  await dialog(page).getByRole("button", { name: "Delete 2 resources", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  const active = (await calls(page))[0].request;
  await controls(page, { syncStatus: "retrying" });
  await expect(dialog(page)).toHaveCount(0);
  expect((await calls(page, "cluster_resource_delete_cancel")).map(call => call.request)).toEqual([cancelScope(active)]);
  await release(page); await page.waitForTimeout(150);
  expect(await calls(page)).toHaveLength(1); await expect(remove(page)).toBeDisabled();
});

for (const dismissal of ["Cancel", "Escape"]) test(`${dismissal} dismisses confirmation without mutation or cancellation IPC`, async ({ page }) => {
  await fixture(page); await row(page).check(); await remove(page).click();
  if (dismissal === "Escape") await page.keyboard.press("Escape");
  else await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0); await expect(row(page)).toBeChecked();
  expect(await calls(page)).toEqual([]); expect(await calls(page, "cluster_resource_delete_cancel")).toEqual([]);
});

test("select-all is current-page only; page and filter changes do not resurrect selection", async ({ page }) => {
  await fixture(page, "config-maps", { paginated: true }); await all(page).check();
  await clusterAction(page, "Next page"); await expect(row(page, "gamma")).toBeEnabled(); await expect(remove(page)).toHaveCount(0);
  await all(page).check(); await remove(page).click(); await expect(dialog(page).getByRole("listitem")).toHaveText(["team-a/gamma"]);
  await page.keyboard.press("Escape"); await clusterAction(page, "Previous page");
  await expect(row(page)).toBeEnabled(); await expect(row(page)).not.toBeChecked();
  await row(page).check(); await page.getByRole("textbox", { name: "Search Config Maps", exact: true }).fill("alpha");
  await expect(remove(page)).toHaveCount(0); await expect(row(page)).toBeEnabled();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(row(page, "beta")).toBeEnabled(); await expect(row(page)).not.toBeChecked();
  expect(await calls(page)).toEqual([]);
});

for (const change of ["namespace", "route", "session"]) test(`${change} change resets selection`, async ({ page }) => {
  await fixture(page); await row(page).check();
  if (change === "namespace") await namespace(page, "team-b");
  else if (change === "route") await page.evaluate(() => { location.hash = "/cluster/one?section=services"; });
  else { await clusterAction(page, "Disconnect"); await clusterAction(page, "Connect to cluster"); }
  await expect(row(page, "alpha", change === "namespace" ? "team-b" : "team-a")).toBeEnabled();
  await expect(remove(page)).toHaveCount(0); expect(await calls(page)).toEqual([]);
});

for (const width of [1440, 390]) for (const dock of [false, true]) test(`${width}px actions stay bottom-right, Delete immediately left of Create${dock ? " with Pod dock" : ""}`, async ({ page }) => {
  await fixture(page, "pods"); await page.setViewportSize({ width, height: 900 });
  await row(page).check(); expect(await calls(page, "cluster_pod_detail")).toEqual([]);
  await expect(page.getByRole("complementary", { name: "Pod dock", exact: true })).toHaveCount(0);
  if (dock) {
    await page.getByRole("button", { name: "alpha", exact: true }).click();
    const details = page.getByRole("region", { name: "Resource details", exact: true });
    await details.getByRole("button", { name: "Logs", exact: true }).click();
    await expect(details).toHaveCount(0);
    await expect.poll(() => page.locator(".resource-inspector").evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("complementary", { name: "Pod dock", exact: true })).toBeVisible();
  }
  const group = page.getByRole("group", { name: "Resource actions", exact: true });
  await expect(group).toHaveCSS("pointer-events", "none");
  await expect(group).toHaveCSS("background-image", /linear-gradient/);
  const create = group.getByRole("button").last();
  await expect(remove(page)).toBeInViewport(); await expect(create).toBeInViewport();
  const { del, add } = await group.evaluate(element => {
    const buttons = element.querySelectorAll("button");
    return { del: buttons[0].getBoundingClientRect().toJSON(), add: buttons[buttons.length - 1].getBoundingClientRect().toJSON() };
  });
  expect(del.x + del.width).toBeLessThanOrEqual(add.x); expect(add.x - del.x - del.width).toBeLessThan(24);
  expect(Math.abs(del.y - add.y)).toBeLessThan(2); expect(add.x + add.width).toBeGreaterThan(width - 40);
  const parent = (await group.locator("..").boundingBox())!;
  expect(parent.y + parent.height - del.y - del.height).toBeLessThan(40);
  if (dock) { const panel = (await page.getByRole("complementary", { name: "Pod dock", exact: true }).boundingBox())!; expect(del.y + del.height).toBeLessThanOrEqual(panel.y); }
  await create.click(); await expect(dialog(page)).toContainText("Resource YAML");
  await page.keyboard.press("Escape"); await remove(page).click(); await expect(dialog(page)).toContainText("team-a/alpha");
});

test("sequential bounded batch ignores double confirm and distinguishes accepted from gone", async ({ page }) => {
  await fixture(page, "config-maps", { hold: true }); await all(page).check(); await remove(page).click();
  await dialog(page).getByRole("button", { name: "Delete 2 resources", exact: true }).dblclick();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await expect(dialog(page)).toContainText("one at a time");
  expect(await page.evaluate(() => (window as MockWindow).__deleteMaxActive)).toBe(1);
  await release(page); await expect(dialog(page)).toContainText("2 accepted or deleted; 0 failed");
  const requests = (await calls(page)).map(call => call.request);
  expect(requests.map(r => r.name)).toEqual(["alpha", "beta"]); expect(requests[1].readId).toBeGreaterThan(requests[0].readId as number);
  expect(await page.evaluate(() => (window as MockWindow).__deleteMaxActive)).toBe(1);
  await expect(dialog(page).getByLabel("Deletion results")).toContainText("grace periods or finalizers may still apply");
  await expect(page.getByRole("table").getByText("alpha", { exact: true })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Close", exact: true }).filter({ hasText: /^Close$/ }).click(); await expect(remove(page)).toHaveCount(0);
  expect(await calls(page, "cluster_resource_delete_cancel")).toEqual([]);
});

for (const [failure, message] of [["conflict", "changed or was replaced"], ["permissionDenied", "RBAC get and delete"], ["notFound", "Not found"], ["raw synthetic-secret-9x", "operation failed"]]) test(`mixed ${failure} and deleted result retains only failed selection and sanitizes errors`, async ({ page }) => {
  await fixture(page, "config-maps", { failure, failName: "alpha", deleted: true }); await all(page).check(); await remove(page).click();
  await dialog(page).getByRole("button", { name: "Delete 2 resources", exact: true }).click();
  await expect(dialog(page)).toContainText("1 accepted or deleted; 1 failed");
  await expect(dialog(page).getByRole("alert")).toContainText(`team-a/alpha:`); await expect(dialog(page).getByRole("alert")).toContainText(message);
  await expect(dialog(page)).not.toContainText("synthetic-secret-9x"); await expect(dialog(page)).toContainText("team-a/beta: Deleted");
  await dialog(page).getByRole("button", { name: "Close", exact: true }).filter({ hasText: /^Close$/ }).click();
  await expect(row(page)).toBeChecked(); await expect(row(page, "beta")).not.toBeChecked(); expect(await calls(page)).toHaveLength(2);
});

for (const malformed of ["null", "array", "clusterId", "sessionId", "kind", "namespace", "name", "uid", "resourceVersion", "flags", "missingAccepted"]) test(`malformed ${malformed} result cannot claim deletion or clear selection`, async ({ page }) => {
  await fixture(page, "config-maps", { malformed }); await row(page).check(); await remove(page).click();
  await dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true }).click();
  await expect(dialog(page)).toContainText("0 accepted or deleted; 1 failed"); await expect(dialog(page).getByRole("alert")).toContainText("unsupported response");
  await expect(dialog(page)).toContainText("outcome is not assumed");
  await dialog(page).getByRole("button", { name: "Close", exact: true }).filter({ hasText: /^Close$/ }).click(); await expect(row(page)).toBeChecked(); expect(await calls(page)).toHaveLength(1);
});

for (const disposal of ["stop", "route", "namespace", "session"]) test(`${disposal} cancels exactly the active lane and ignores late completion without submitting remaining targets`, async ({ page }) => {
  await fixture(page, "config-maps", { hold: true }); await all(page).check(); await remove(page).click();
  await dialog(page).getByRole("button", { name: "Delete 2 resources", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(1); const old = (await calls(page))[0].request;
  if (disposal === "stop") await dialog(page).getByRole("button", { name: "Stop deleting", exact: true }).click();
  else if (disposal === "route") await page.evaluate(() => { location.hash = "/cluster/one?section=services"; });
  else if (disposal === "session") {
    await page.evaluate(() => { location.hash = "/catalog"; });
    await expect(dialog(page)).toHaveCount(0);
    await page.evaluate(() => { location.hash = "/cluster/one?section=config-maps"; });
    await expect(row(page)).toBeEnabled();
    await expect.poll(async () => (await calls(page, "cluster_connect")).at(-1)?.request.sessionId).not.toBe(old.sessionId);
  }
  else {
    // Exercise namespace owner disposal while the modal correctly makes pointer controls inert.
    await page.getByRole("button", { name: /^Namespace(?:\s|$)/, includeHidden: true }).evaluate(node => (node as HTMLButtonElement).click());
    await page.getByRole("option", { name: "team-b", exact: true, includeHidden: true }).dispatchEvent("click");
  }
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await calls(page, "cluster_resource_delete_cancel")).map(call => call.request)).toEqual([cancelScope(old)]);
  if (disposal === "stop") await expect(page.getByRole("status").filter({ hasText: "Stopping does not undo it" })).toBeVisible();
  await release(page);
  // Allow the held promise's continuation and React effects to run before asserting no second request.
  await page.waitForTimeout(150);
  expect(await calls(page)).toHaveLength(1); await expect(page.getByText("2 accepted or deleted; 0 failed", { exact: false })).toHaveCount(0);
  expect(await calls(page, "cluster_resource_delete_cancel")).toHaveLength(1);
});

test("live Pod replacement UID drops selection instead of selecting the same name's new object", async ({ page }) => {
  await fixture(page, "pods"); await clusterAction(page, "Enable live sync");
  await expect.poll(async () => (await calls(page, "cluster_pod_sync_open")).length).toBe(1);
  await row(page).check(); await controls(page, { replacement: true });
  await expect(remove(page)).toHaveCount(0); await expect(row(page)).not.toBeChecked();
  await row(page).check(); await remove(page).click(); await dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true }).click();
  await expect(dialog(page)).toContainText("1 accepted or deleted; 0 failed");
  expect((await calls(page))[0].request.uid).toBe("alpha-replacement");
});

test("late stopped deletion cannot clear new selection or overwrite a reopened confirmation", async ({ page }) => {
  await fixture(page, "config-maps", { hold: true });
  await row(page).check(); await remove(page).click();
  await dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  const old = (await calls(page))[0].request;
  await dialog(page).getByRole("button", { name: "Stop deleting", exact: true }).click();
  await expect(row(page)).toBeEnabled();
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await row(page, "beta").check(); await remove(page).click();
  await expect(dialog(page).getByRole("listitem")).toHaveText(["team-a/beta"]);
  await release(page); await page.waitForTimeout(150);
  await expect(dialog(page).getByRole("listitem")).toHaveText(["team-a/beta"]);
  await expect(dialog(page).getByLabel("Deletion results")).toHaveCount(0);
  expect((await calls(page, "cluster_resource_delete_cancel")).map(call => call.request)).toEqual([cancelScope(old)]);
  await dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true }).click();
  await expect(dialog(page)).toContainText("1 accepted or deleted; 0 failed");
  expect((await calls(page)).map(call => call.request.name)).toEqual(["alpha", "beta"]);
});

test("status filter changes reset selection even when the same objects remain visible", async ({ page }) => {
  await fixture(page); await row(page).check();
  await page.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "Running", exact: true }).click();
  await expect(row(page)).toBeEnabled(); await expect(row(page)).not.toBeChecked();
  await expect(remove(page)).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
});
