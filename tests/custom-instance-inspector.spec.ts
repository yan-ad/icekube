import { expect, test, type Page } from "@playwright/test";
import type { CustomInstancePage, CustomRead } from "../src/app/cluster/customResourcesApi";

type InstanceRequest = CustomRead & { target?: { definitionName: string; definitionUid: string }; namespace?: string | null };
type Fixture = Window & {
  __instanceCalls: { command: string; request: InstanceRequest }[];
  __instanceResponse: Omit<CustomInstancePage, "fetchedAt">;
  __unexpectedInstanceCommands: string[];
};
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
  expect(await page.evaluate(() => (window as Fixture).__unexpectedInstanceCommands)).toEqual([]);
});

async function setup(page: Page, scope: "Namespaced" | "Cluster" = "Namespaced") {
  await page.addInitScript(scope => {
    let revision = 0;
    Object.assign(window, { isTauri: true, __instanceCalls: [], __unexpectedInstanceCommands: [], __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: any }) => {
      const request = args?.request;
      (window as any).__instanceCalls.push({ command, request });
      if (command === "cluster_permissions_review") return { ...request, authorizationEpoch: request.sessionId, revision: 0, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
        items: request.checks.map((check: unknown) => ({ check, decision: "allowed", reason: null })) };
       if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], pinnedItems: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: ["file=/fixtures/config"], color: "#476BA1", status: "disconnected", pinned: false, pinnedSections: [] }] };
       if (command === "catalog_connection_states") return [];
      if (command === "cluster_session_open") return { ...request, sessionId: "session-one", contextName: "dev", status: "disconnected", apiVersion: null, error: null };
      if (command === "cluster_connect") return { ...request, contextName: "dev", status: "connected", apiVersion: "v1.35", error: null };
      if (command === "cluster_pod_forward_list") return [];
      if (command === "cluster_namespace_cache_get") return null;
      if (command === "cluster_namespace_cache_refresh") return { clusterId: request.clusterId, sessionId: request.sessionId, names: ["alpha", "beta"], fetchedAt: Date.now(), expiresAt: Date.now() + 30_000, partial: false };
      if (command === "update_state") return { phase: "idle", version: null, error: null };
      if (command === "cluster_resources") return { ...request, namespace: null, continueToken: null, metrics: null, truncated: false, fetchedAt: 1793000000000, items: [] };
      if (command === "cluster_custom_resource_definitions") return { ...request, kind: "customResourceDefinitions", namespace: null, continueToken: null, metrics: null, truncated: false, fetchedAt: 1793000000000,
        items: [{ name: "widgets.example.test", uid: "definition-one", resourceVersion: null, namespace: null, status: "Unknown", createdAt: null, node: null,
          columns: { group: "example.test", kind: "Widget", plural: "widgets", scope, versions: "v1beta1,v1" } }] };
      if (command === "cluster_custom_resources") {
        revision++;
        const target = { ...request.target };
        const response: Omit<CustomInstancePage, "fetchedAt"> = { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, target, group: "example.test", version: "v1", plural: "widgets", kind: "Widget", namespaced: scope === "Namespaced", namespace: request.namespace ?? null, continueToken: null, truncated: true,
          items: (scope === "Namespaced" ? ["alpha", "beta"] : [null]).map((namespace, index) => ({ name: "shared-widget", uid: `widget-${index}-${revision}`, namespace,
            createdAt: index === 0 ? "2026-10-20T10:00:00Z" : null, labelCount: index + 2 })) };
        (window as Fixture).__instanceResponse = response;
        return response;
      }
      if (["cluster_resources_cancel", "cluster_custom_resource_definitions_cancel", "cluster_custom_resources_cancel", "cluster_disconnect", "cluster_permissions_refresh"].includes(command)) return null;
      (window as Fixture).__unexpectedInstanceCommands.push(command);
      throw new Error(`Unexpected IPC ${command}`);
    } } });
  }, scope);
}

const route = "/#/cluster/one?section=custom-resource-instances&definition=widgets.example.test";
async function assertInventoryOnly(page: Page) {
  const calls = await page.evaluate(() => (window as any).__instanceCalls as { command: string }[]);
  expect(calls.filter(call => /detail|mutat|delete|patch|create|yaml/.test(call.command))).toEqual([]);
  const reads = await page.evaluate(() => (window as Fixture).__instanceCalls.filter(call => call.command === "cluster_custom_resources"));
  for (const { request } of reads) {
    expect(request).toMatchObject({ clusterId: "one", sessionId: "session-one", namespace: null,
      target: { definitionName: "widgets.example.test", definitionUid: "definition-one" } });
    expect(request.readId).toEqual(expect.any(Number));
    expect(request.readId).toBeGreaterThan(0);
    expect(request).not.toHaveProperty("definitionName");
  }
}

test("names open exact UID and namespace captured metadata without a named read", async ({ page }) => {
  await setup(page);
  await page.goto(route);
  const table = page.getByRole("table", { name: "Widget custom resources", exact: true });
  await table.getByRole("row").filter({ has: page.getByRole("cell", { name: "beta", exact: true }) }).getByRole("button", { name: "shared-widget", exact: true }).click();
  const response = await page.evaluate(() => (window as Fixture).__instanceResponse);
  const pane = page.getByRole("region", { name: "Resource details", exact: true });
  await expect(pane.getByRole("heading", { name: "Widget:shared-widget", exact: true })).toBeVisible();
  for (const value of ["beta", response.items[1].uid, "Unknown", "example.test", "v1", "Namespaced", "definition-one", "Partial inventory snapshot", "Not included in the inventory snapshot"])
    await expect(pane.getByText(value, { exact: true })).toBeVisible();
  await expect(pane.getByText(/Metadata-only inventory snapshot, not live details/)).toBeVisible();
  await expect(pane.getByRole("button", { name: /Refresh details|Edit|Delete/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const betaButton = table.getByRole("row").filter({ has: page.getByRole("cell", { name: "beta", exact: true }) }).getByRole("button", { name: "shared-widget", exact: true });
  await expect(betaButton).toBeFocused();
  const alphaButton = table.getByRole("row").filter({ has: page.getByRole("cell", { name: "alpha", exact: true }) }).getByRole("button", { name: "shared-widget", exact: true });
  await alphaButton.focus();
  await page.keyboard.press("Enter");
  await expect(pane.getByText(response.items[0].uid, { exact: true })).toBeVisible();
  await expect(pane.getByText("alpha", { exact: true })).toBeVisible();
  await expect(pane.getByText("2026-10-20T10:00:00Z", { exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "Close inspector", exact: true }).click();
  await alphaButton.focus();
  await page.keyboard.press("Space");
  await expect(pane).toBeVisible();
  await assertInventoryOnly(page);
});

test("refresh keeps a clearly captured snapshot until the row is selected again", async ({ page }) => {
  await setup(page, "Cluster");
  await page.goto(route);
  const button = page.getByRole("table").getByRole("button", { name: "shared-widget", exact: true });
  await button.click();
  const captured = await page.evaluate(() => (window as Fixture).__instanceResponse);
  const pane = page.getByRole("region", { name: "Resource details", exact: true });
  await expect(pane.getByText("Cluster-scoped", { exact: true })).toBeVisible();
  await expect(pane.getByText(captured.items[0].uid, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh custom-resource-instances", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Fixture).__instanceResponse.readId)).toBeGreaterThan(captured.readId);
  const refreshed = await page.evaluate(() => (window as Fixture).__instanceResponse);
  expect(refreshed.items[0].uid).not.toBe(captured.items[0].uid);
  await expect(pane.getByText(captured.items[0].uid, { exact: true })).toBeVisible();
  await expect(pane.getByText(/does not update when the inventory refreshes/)).toBeVisible();
  await button.click();
  await expect(pane.getByText(refreshed.items[0].uid, { exact: true })).toBeVisible();
  await expect(pane.getByText(captured.items[0].uid, { exact: true })).toHaveCount(0);
  await assertInventoryOnly(page);
});

test("missing selected definition fails honestly without instance or detail reads", async ({ page }) => {
  await setup(page);
  await page.goto("/#/cluster/one?section=custom-resource-instances&definition=missing.example.test");
  await expect(page.getByText("Custom resource definition unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toHaveCount(0);
  const commands = await page.evaluate(() => (window as any).__instanceCalls.map((call: any) => call.command));
  expect(commands).toContain("cluster_custom_resource_definitions");
  expect(commands).not.toContain("cluster_custom_resources");
  await assertInventoryOnly(page);
});
