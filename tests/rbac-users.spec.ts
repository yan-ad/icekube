import { expect, test } from "@playwright/test";

async function mockUsers(page: import("@playwright/test").Page, mode: "scoped" | "denied" | "unknown" = "scoped") {
  await page.addInitScript(({ mode }) => {
    const calls: { command: string; request: any }[] = [];
    Object.assign(window, { isTauri: true, __usersCalls: calls, __TAURI_INTERNALS__: { invoke: async (command: string, args: any) => {
      const request = args?.request;
      calls.push({ command, request });
      if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", status: "disconnected", pinned: false }] };
      if (command === "cluster_session_open") return { clusterId: "one", sessionId: "session", contextName: "dev", status: "disconnected", apiVersion: null, error: null };
      if (command === "cluster_connect") return { ...request, contextName: "dev", status: "connected", apiVersion: "v1.35.8", error: null };
      if (command === "cluster_permissions_review") return {
        clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
        authorizationEpoch: "epoch", revision: calls.length, checkedAt: Date.now(), expiresAt: Date.now() + 30000,
        items: request.checks.map((check: any) => {
          const allowed = mode === "scoped" && check.action === "list" && (check.kind === "clusterRoles" || check.kind === "serviceAccounts" && check.namespace === "team");
          return { check, decision: mode === "unknown" ? "unknown" : allowed ? "allowed" : "denied", reason: mode === "unknown" ? "reviewUnavailable" : allowed ? null : "reviewDenied" };
        }),
      };
      if (command === "cluster_rbac_management_snapshot") return { ...request, users: [], templates: [], truncated: false, fetchedAt: Date.now() };
      if (command === "cluster_resources") throw "permissionDenied";
      return null;
    } } });
  }, { mode });
}

const managementReads = (page: import("@playwright/test").Page) => page.evaluate(() => (window as any).__usersCalls.filter((call: any) => call.command === "cluster_rbac_management_snapshot"));
async function chooseUserNamespace(page: import("@playwright/test").Page) {
  await expect(page.getByRole("textbox", { name: "Known user namespace", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Namespace options", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Namespace options", exact: true });
  await panel.getByRole("button", { name: "Enter namespace", exact: true }).click();
  await panel.getByRole("textbox", { name: "Known namespace", exact: true }).fill("team");
  await panel.getByRole("button", { name: "Use namespace", exact: true }).click();
  await page.keyboard.press("Escape");
}

test("Users navigation remains available for namespace-scoped management without directory access", async ({ page }) => {
  await mockUsers(page);
  await page.goto("/#/cluster/one?section=deployments");
  await expect(page.getByText("Access denied", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand Access Control", exact: true }).click();
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose a user namespace" })).toBeVisible();
  expect(await managementReads(page)).toEqual([]);
  await chooseUserNamespace(page);
  await expect(page.getByText("No managed users in this namespace.", { exact: true })).toBeVisible();
  expect(await managementReads(page)).toEqual([expect.objectContaining({ request: expect.objectContaining({ namespace: "team" }) })]);
  const calls = await page.evaluate(() => (window as any).__usersCalls);
  expect(calls.filter((call: any) => call.command === "cluster_rbac_users")).toEqual([]);
  expect(calls.filter((call: any) => call.command === "cluster_connect")).toHaveLength(1);
});

test("denied managed user access permits namespace selection but never requests a snapshot", async ({ page }) => {
  await mockUsers(page, "denied");
  await page.goto("/#/cluster/one?section=users");
  await expect(page.getByRole("heading", { name: "Choose a user namespace" })).toBeVisible();
  expect(await managementReads(page)).toEqual([]);
  await chooseUserNamespace(page);
  await expect(page.getByText("Access denied", { exact: true })).toBeVisible();
  expect(await managementReads(page)).toEqual([]);
});

test("unknown managed user access never requests a snapshot", async ({ page }) => {
  await mockUsers(page, "unknown");
  await page.goto("/#/cluster/one?section=users");
  await expect(page.getByRole("heading", { name: "Choose a user namespace" })).toBeVisible();
  expect(await managementReads(page)).toEqual([]);
  await chooseUserNamespace(page);
  await expect(page.getByText("Access is unverified", { exact: true })).toBeVisible();
  expect(await managementReads(page)).toEqual([]);
});

test("Observed subject API rejects stale scope, unknown fields, duplicate identities and unsafe text", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(async () => {
    const path = "/src/app/cluster/rbacApi.ts";
    const { parseUsersPage } = await import(/* @vite-ignore */ path);
    const request = { clusterId: "one", sessionId: "session", readId: 1, namespace: null };
    const item = { id: JSON.stringify(["User", null, "system:operator"]), kind: "User", name: "system:operator", namespace: null, bindings: [], bindingsTruncated: false };
    const response = { ...request, items: [item], truncated: false, fetchedAt: 1, coverage: ["roleBindings", "clusterRoleBindings", "serviceAccounts"].map(resource => ({ resource, state: "complete" })) };
    parseUsersPage(response, request);
    return [{ ...response, sessionId: "old" }, { ...response, readId: 2 }, { ...response, raw: "private" }, { ...response, items: [item, item] }, { ...response, coverage: [] }, { ...response, items: [{ ...item, name: "unsafe\ntext" }] }, { ...response, items: [{ ...item, token: "private" }] }].every(value => { try { parseUsersPage(value, request); return false; } catch { return true; } });
  })).toBe(true);
});
