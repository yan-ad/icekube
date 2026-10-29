import { expect, test, type Page } from "@playwright/test";
import type { PermissionCheck } from "../src/app/cluster/permissionsApi";
import type { ResourceReference } from "../src/app/cluster/detailApi";

type Request = Record<string, unknown> & { reference?: ResourceReference; checks?: PermissionCheck[] };
type Call = { command: string; request: Request };
type Controls = { denied?: boolean; holdDelete?: boolean; holdDetail?: boolean; detailError?: boolean; missingVersion?: boolean; mismatch?: boolean; failure?: boolean };
type FixtureWindow = Window & { __paneCalls: Call[]; __paneControls: Controls; __paneUnexpected: string[]; __paneRelease: () => void };
const pane = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });
const remove = (page: Page) => pane(page).getByRole("button", { name: "Delete resource", exact: true });
const dialog = (page: Page) => page.getByRole("dialog");
const calls = (page: Page, command: string) => page.evaluate(command => (window as FixtureWindow).__paneCalls.filter(call => call.command === command), command);
const controls = (page: Page, value: Controls) => page.evaluate(value => Object.assign((window as FixtureWindow).__paneControls, value), value);

async function fixture(page: Page, options: Controls = {}, section = "config-maps") {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(({ options, section }) => {
    const calls: Call[] = [], unexpected: string[] = [], pending: (() => void)[] = [];
    const control = { ...options };
    const item = (kind: unknown, name = "alpha", namespace: string | null = kind === "namespaces" ? null : "team-a") => ({
      name, namespace, uid: `${name}-uid`, resourceVersion: "list-version", status: "Active", createdAt: null, columns: {}, node: null,
    });
    Object.assign(window, { isTauri: true, __paneCalls: calls, __paneControls: control, __paneUnexpected: unexpected,
      __paneRelease: () => { control.holdDelete = false; control.holdDetail = false; pending.splice(0).forEach(resolve => resolve()); },
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Request }) => {
        const r: Request = structuredClone(args?.request ?? {});
        calls.push({ command, request: r });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "catalog_connection_states") return [];
        if (command === "preferences_get") return null;
        if (command === "update_state") return { phase: "idle", version: null, error: null };
        if (command === "cluster_permissions_review") return { clusterId: r.clusterId, sessionId: r.sessionId, readId: r.readId,
          authorizationEpoch: "pane-epoch", revision: r.readId, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
          items: r.checks!.map(check => ({ check, decision: control.denied && check.action === "delete" ? "denied" : "allowed", reason: null })) };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: r.clusterId, sessionId: r.sessionId ?? "pane-lease", contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        if (["cluster_disconnect", "cluster_permissions_cancel", "cluster_resources_cancel", "cluster_resource_detail_cancel", "cluster_resource_delete_cancel", "cluster_resource_collection_cancel"].includes(command)) return null;
        if (command === "cluster_resources" || command === "cluster_custom_resource_definitions") return {
          ...r, kind: command === "cluster_custom_resource_definitions" ? "customResourceDefinitions" : r.kind, namespace: r.namespace ?? null,
          items: command === "cluster_custom_resource_definitions" ? [] : r.kind === "namespaces" ? [item(r.kind, section === "namespaces" ? "alpha" : "team-a", null)] : [item(r.kind)],
          continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null,
        };
        if (command === "cluster_custom_resource_definitions_cancel") return null;
        if (command === "cluster_resource_detail") {
          if (control.holdDetail) await new Promise<void>(resolve => pending.push(resolve));
          if (control.detailError) throw "permissionDenied";
          const reference = r.reference!;
          const result = item(reference.kind, reference.name, reference.namespace);
          const response = { ...r, reference: { ...reference, uid: result.uid }, item: { ...result,
            resourceVersion: control.missingVersion ? null : "detail-version", ...(control.mismatch ? { uid: "wrong-uid" } : {}) }, related: {} };
          return response;
        }
        if (command === "cluster_resource_collection") return { ...r, state: "complete", items: [] };
        if (command === "cluster_resource_delete") {
          if (control.holdDelete) await new Promise<void>(resolve => pending.push(resolve));
          if (control.failure) throw "conflict";
          return { ...r, accepted: true, deleted: false };
        }
        unexpected.push(command); throw "Unexpected synthetic IPC";
      } },
    });
  }, { options, section });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/cluster/one?section=${section}`);
  await page.getByRole("table").getByRole("button", { name: "alpha", exact: true }).click();
  await expect(pane(page)).toBeVisible();
}
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as FixtureWindow).__paneUnexpected ?? [])).toEqual([]);
});

for (const section of ["config-maps", "namespaces"]) test(`${section}: inspector confirms exactly the detail UID/version and retains acceptance until closed`, async ({ page }) => {
  await fixture(page, {}, section);
  await expect(remove(page)).toBeEnabled();
  await remove(page).focus(); await page.keyboard.press("Enter");
  await expect(dialog(page).getByRole("listitem")).toHaveText(section === "namespaces" ? "alpha" : "team-a/alpha");
  await expect(dialog(page).getByLabel("Deletion target")).toContainText("Cluster: Development");
  expect(await calls(page, "cluster_resource_delete")).toEqual([]);
  const reads = (await calls(page, "cluster_resource_detail")).length;
  const lists = (await calls(page, "cluster_resources")).length;
  await dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true }).click();
  await expect(dialog(page).getByLabel("Deletion results")).toContainText("Deletion accepted; grace periods or finalizers may still apply.");
  await expect(dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true })).toHaveCount(0);
  expect(await calls(page, "cluster_resource_delete")).toEqual([{ command: "cluster_resource_delete", request: {
    clusterId: "one", sessionId: "pane-lease", kind: section === "namespaces" ? "namespaces" : "configMaps", namespace: section === "namespaces" ? null : "team-a",
    name: "alpha", uid: "alpha-uid", resourceVersion: "detail-version", readId: expect.any(Number),
  } }]);
  expect((await calls(page, "cluster_resource_detail")).length).toBe(reads);
  expect((await calls(page, "cluster_resources")).length).toBe(lists);
  await dialog(page).getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await calls(page, "cluster_resource_detail")).length).toBeGreaterThan(reads);
  await expect.poll(async () => (await calls(page, "cluster_resources")).length).toBeGreaterThan(lists);
});

for (const cancel of ["Cancel", "Escape"]) test(`${cancel} before submission sends no mutation`, async ({ page }) => {
  await fixture(page);
  await remove(page).click();
  if (cancel === "Escape") await page.keyboard.press("Escape");
  else await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await calls(page, "cluster_resource_delete")).toEqual([]);
  expect(await calls(page, "cluster_resource_delete_cancel")).toEqual([]);
  await expect(remove(page)).toBeEnabled();
});

test("known denied delete access never opens confirmation", async ({ page }) => {
  await fixture(page, { denied: true });
  await expect(remove(page)).toBeDisabled();
  expect(await calls(page, "cluster_resource_delete")).toEqual([]);
  expect((await calls(page, "cluster_permissions_review")).some(call => call.request.checks?.some(check => check.action === "delete" && check.name === "alpha" && check.namespace === "team-a" && check.kind === "configMaps"))).toBe(true);
});

test("refresh disables the retained entry and invalidates an unsubmitted confirmation", async ({ page }) => {
  await fixture(page); await remove(page).click();
  await controls(page, { holdDetail: true, detailError: true });
  const reads = await calls(page, "cluster_resource_detail");
  await pane(page).getByRole("button", { name: /Refresh details/ }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await calls(page, "cluster_resource_detail")).length).toBeGreaterThan(reads.length);
  await expect(dialog(page)).toHaveCount(0);
  await expect(remove(page)).toBeDisabled();
  await expect(pane(page)).toContainText("Inventory changed or became unavailable");
  await page.evaluate(() => (window as FixtureWindow).__paneRelease());
  await expect(pane(page)).toContainText("Retained details may be stale");
  await expect(remove(page)).toBeDisabled();
  expect(await calls(page, "cluster_resource_delete")).toEqual([]);
});

for (const bad of ["missingVersion", "mismatch"] as const) test(`${bad}: invalid detail identity cannot be deleted`, async ({ page }) => {
  await fixture(page, { [bad]: true });
  if (bad === "mismatch") {
    await expect(pane(page)).toContainText("Resource details unavailable");
    await expect(remove(page)).toHaveCount(0);
  } else await expect(remove(page)).toBeDisabled();
  expect(await calls(page, "cluster_resource_delete")).toEqual([]);
});

test("stopping a submitted request preserves visible uncertainty and cancels only its exact scope", async ({ page }) => {
  await fixture(page, { holdDelete: true });
  await remove(page).click();
  await dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_resource_delete")).length).toBe(1);
  const submitted = (await calls(page, "cluster_resource_delete"))[0].request;
  await dialog(page).getByRole("button", { name: "Stop deleting", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(pane(page)).toContainText("Stopping does not undo it");
  expect((await calls(page, "cluster_resource_delete_cancel")).map(call => call.request)).toEqual([{
    clusterId: submitted.clusterId, sessionId: submitted.sessionId, kind: submitted.kind, readId: submitted.readId,
  }]);
  await page.evaluate(() => (window as FixtureWindow).__paneRelease());
  await expect(pane(page)).toContainText("Stopping does not undo it");
  expect(await calls(page, "cluster_resource_delete")).toHaveLength(1);
});

test("conflict stays in the dialog until close without claiming deletion", async ({ page }) => {
  await fixture(page, { failure: true }); await remove(page).click();
  await dialog(page).getByRole("button", { name: "Delete 1 resource", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("Resource changed or was replaced");
  await expect(dialog(page)).toContainText("0 accepted or deleted; 1 failed");
  expect(await calls(page, "cluster_resource_delete")).toHaveLength(1);
});
