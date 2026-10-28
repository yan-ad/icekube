import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, mode = "allowed") {
  await page.addInitScript(({ mode }) => {
    const calls: { command: string; request: any }[] = [];
    const rule = { apiGroups: [""], resources: ["pods"], verbs: ["get", "list", "watch"], resourceNames: [], nonResourceURLs: [] };
    const template = { name: "template-namespaced-resources___viewer", uid: "role-uid", resourceVersion: "42", scope: "namespaced", rules: [rule] };
    const clusterTemplate = { ...template, name: "template-cluster-resources___viewer", scope: "cluster", rules: [{ ...rule, resources: ["nodes"] }] };
    if (mode === "incompatible") clusterTemplate.rules[0].apiGroups = ["*"];
    const robot = { name: "robot", namespace: "team", uid: "robot-uid", resourceVersion: "7", assignments: [{ templateName: template.name, templateUid: template.uid, templateResourceVersion: template.resourceVersion, namespaces: ["team"], allNamespaces: false }], clusterAccess: mode === "incompatible" ? "read" : "none", clusterTemplate: mode === "incompatible" ? { name: clusterTemplate.name, uid: clusterTemplate.uid, resourceVersion: clusterTemplate.resourceVersion } : null };
    let savedPlan: any;
    const state = { epoch: "epoch", planLifetime: 120000, applyDelay: 30, deferSnapshot: false, releaseSnapshot: null as null | (() => void) };
    Object.assign(window, { isTauri: true, __managedState: state, __managedCalls: calls, __TAURI_INTERNALS__: { invoke: async (command: string, args: any) => {
      const request = args?.request; calls.push({ command, request });
      if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", status: "disconnected", pinned: false }] };
      if (command === "cluster_session_open") return { clusterId: "one", sessionId: "session", contextName: "dev", status: "disconnected", apiVersion: null, error: null };
      if (command === "cluster_connect") return { ...request, contextName: "dev", status: "connected", apiVersion: "v1.35.8", error: null };
      if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, authorizationEpoch: state.epoch, revision: calls.length, checkedAt: Date.now(), expiresAt: Date.now() + 30000, items: request.checks.map((check: any) => ({ check, decision: mode === "unknown" ? "unknown" : check.kind === "namespaces" ? "denied" : "allowed", reason: mode === "unknown" ? "reviewUnavailable" : null })) };
      if (command === "cluster_resources") throw "permissionDenied";
      if (command === "cluster_rbac_management_snapshot") { if (mode === "snapshotError") throw "permissionDenied"; if (state.deferSnapshot) { state.deferSnapshot = false; await new Promise<void>(resolve => { state.releaseSnapshot = resolve; }); } return { ...request, users: [{ ...robot, namespace: request.namespace }], templates: [template, clusterTemplate], truncated: false, fetchedAt: Date.now() }; }
      if (command === "cluster_rbac_user_plan") {
        savedPlan = { ...request, planId: "0123456789abcdef0123456789abcdef", expiresAt: Date.now() + state.planLifetime, summary: request.user.assignments.map((a: any) => ({ ...rule, namespaces: a.allNamespaces ? null : a.namespaces })), steps: [{ operation: request.operation, kind: "ServiceAccount", name: request.user.name, namespace: request.user.namespace }], warnings: ["Partial execution is not rolled back."] };
        return savedPlan;
      }
      if (command === "cluster_rbac_user_apply") { await new Promise(resolve => setTimeout(resolve, state.applyDelay)); return { ...request, operation: savedPlan.operation, results: savedPlan.steps.map((step: any) => ({ ...step, state: mode === "partial" ? "failed" : "applied", messageCode: mode === "partial" ? "Conflict" : "applied" })), complete: mode !== "partial" }; }
      return null;
    } } });
  }, { mode });
  await page.goto("/#/cluster/one?section=users");
}
async function chooseNamespace(page: Page) {
  await page.getByRole("textbox", { name: "Known user namespace", exact: true }).fill("team");
  await page.getByRole("button", { name: "Use user namespace", exact: true }).click();
}
const calls = (page: Page, command: string) => page.evaluate(command => (window as any).__managedCalls.filter((call: any) => call.command === command), command);

test("namespace is explicit; creates require server review and fresh confirmation", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("heading", { name: "Choose a user namespace" })).toBeVisible();
  expect(await calls(page, "cluster_rbac_management_snapshot")).toEqual([]);
  await chooseNamespace(page);
  await expect(page.getByRole("table", { name: "Managed users", exact: true })).toContainText("robot");
  await page.getByRole("button", { name: "Create New User", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("new-user");
  await expect(page.getByText(/Credentials are not generated/)).toBeVisible();
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review user changes" })).toBeVisible();
  expect(await calls(page, "cluster_rbac_user_apply")).toEqual([]);
  const planned = (await calls(page, "cluster_rbac_user_plan"))[0].request;
  expect(planned.user).toEqual({ name: "new-user", namespace: "team", uid: null, resourceVersion: null, assignments: [], clusterAccess: "none", clusterTemplate: null });
  await page.getByRole("button", { name: "Confirm create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Changes applied", exact: true })).toBeVisible();
  const applied = await calls(page, "cluster_rbac_user_apply");
  expect(applied).toHaveLength(1);
  expect(applied[0].request.readId).toBeGreaterThan(planned.readId);
  expect(Object.keys(applied[0].request).sort()).toEqual(["clusterId", "planId", "readId", "sessionId"]);
});

test("edit preserves template identities and UID/RV; Escape cancels the exact plan", async ({ page }) => {
  await setup(page); await chooseNamespace(page);
  await page.getByRole("button", { name: "Edit robot", exact: true }).first().click();
  await page.getByRole("checkbox", { name: "All namespaces 1", exact: true }).check();
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review user changes" })).toBeVisible();
  const plan = (await calls(page, "cluster_rbac_user_plan"))[0].request;
  expect(plan.operation).toBe("update"); expect(plan.user.uid).toBe("robot-uid"); expect(plan.user.resourceVersion).toBe("7");
  expect(plan.user.assignments[0]).toEqual({ templateName: "template-namespaced-resources___viewer", templateUid: "role-uid", templateResourceVersion: "42", namespaces: [], allNamespaces: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeVisible();
  expect((await calls(page, "cluster_rbac_management_cancel")).some(call => call.request.readId === plan.readId)).toBe(true);
  expect(await calls(page, "cluster_rbac_user_apply")).toEqual([]);
  await page.getByRole("button", { name: "Delete user", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm delete", exact: true })).toBeVisible();
  const deletion = (await calls(page, "cluster_rbac_user_plan")).at(-1).request;
  expect(deletion.operation).toBe("delete"); expect(deletion.user.assignments[0].allNamespaces).toBe(false);
});

test("role list errors are not an empty registry; unknown access does not fetch", async ({ page }) => {
  await setup(page, "snapshotError"); await chooseNamespace(page);
  await expect(page.getByText("Managed users unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("No managed users in this namespace.", { exact: true })).toHaveCount(0);
});

test("partial execution reports failed changes without a reusable confirmation", async ({ page }) => {
  await setup(page, "partial"); await chooseNamespace(page);
  await page.getByRole("button", { name: "Edit robot", exact: true }).first().click();
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await page.getByRole("button", { name: "Confirm save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Changes partially applied" })).toBeVisible();
  await expect(page.getByText(/failed \(Conflict\)/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm save", exact: true })).toHaveCount(0);
});

test("closed bounded API rejects private fields, Unicode controls, invalid all-namespace grants and unsafe statuses", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(async () => {
    const path = "/src/app/cluster/managedUsersApi.ts";
    const api = await import(/* @vite-ignore */ path);
    const user = { name: "robot", namespace: "team", uid: null, resourceVersion: null, assignments: [], clusterAccess: "none", clusterTemplate: null };
    const request = { clusterId: "one", sessionId: "session", readId: 1, operation: "create", user };
    api.serializePlanRequest(request);
    const invalid = [ { ...request, token: "private" }, { ...request, user: { ...user, token: "private" } }, { ...request, user: { ...user, name: "a\u202eb" } }, { ...request, user: { ...user, namespace: "" } }, { ...request, user: { ...user, assignments: [{ templateName: "template-namespaced-resources___viewer", templateUid: "id", templateResourceVersion: "1", namespaces: ["team"], allNamespaces: true }] } } ];
    const rejected = invalid.every(value => { try { api.serializePlanRequest(value); return false; } catch (reason) { return reason === "invalidInput"; } });
    const read = { clusterId: "one", sessionId: "session", readId: 1, namespace: "team" };
    const snapshot = { ...read, users: [], templates: [], truncated: false, fetchedAt: 1 };
    const responses = [{ ...snapshot, private: "token" }, { ...snapshot, namespace: "other" }, { ...snapshot, templates: [{ name: "private" }] }, { ...snapshot, extra: "x".repeat(2 * 1024 * 1024) }];
    return rejected && responses.every(value => { try { api.parseManagementSnapshot(value, read); return false; } catch (reason) { return reason === "invalidResponse"; } });
  })).toBe(true);
});

test("same allowed permissions under a new epoch require a second review, ordinary revisions do not", async ({ page }) => {
  await page.clock.install(); await setup(page); await chooseNamespace(page);
  await page.getByRole("button", { name: "Edit robot", exact: true }).first().click();
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm save", exact: true })).toBeEnabled();
  await page.clock.runFor(31000);
  await expect(page.getByRole("button", { name: "Confirm save", exact: true })).toBeEnabled();
  const plan = (await calls(page, "cluster_rbac_user_plan"))[0].request;
  expect((await calls(page, "cluster_rbac_management_cancel")).filter(call => call.request.readId === plan.readId)).toHaveLength(0);
  await page.evaluate(() => { (window as any).__managedState.epoch = "next-identity"; });
  await page.clock.runFor(31000);
  await expect(page.getByText("Access identity changed. Review changes again.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm save", exact: true })).toHaveCount(0);
  expect(await calls(page, "cluster_rbac_user_apply")).toHaveLength(0);
  expect((await calls(page, "cluster_rbac_management_cancel")).filter(call => call.request.readId === plan.readId)).toHaveLength(1);
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm save", exact: true })).toBeEnabled();
  expect(await calls(page, "cluster_rbac_user_plan")).toHaveLength(2);
});

test("incompatible saved read-only templates explain the required choice", async ({ page }) => {
  await setup(page, "incompatible"); await chooseNamespace(page);
  await page.getByRole("button", { name: "Edit robot", exact: true }).first().click();
  await expect(page.getByText(/The saved cluster template is incompatible with Read Only/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled();
  expect(await calls(page, "cluster_rbac_user_apply")).toHaveLength(0);
});

test("cancel during apply preserves outcomes and disables namespace editing", async ({ page }) => {
  await page.clock.install(); await setup(page); await chooseNamespace(page);
  await page.evaluate(() => { (window as any).__managedState.applyDelay = 3000; });
  await page.getByRole("button", { name: "Edit robot", exact: true }).first().click();
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await page.getByRole("button", { name: "Confirm save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to Users", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "All namespaces 1", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Change user namespace", exact: true })).toHaveCount(0);
  const apply = (await calls(page, "cluster_rbac_user_apply"))[0].request;
  await page.getByRole("button", { name: "Cancel request", exact: true }).click();
  await page.getByRole("button", { name: "Cancel request", exact: true }).click();
  expect((await calls(page, "cluster_rbac_management_cancel")).filter(call => call.request.readId === apply.readId)).toHaveLength(1);
  await page.clock.runFor(3000);
  await expect(page.getByRole("heading", { name: "Changes applied", exact: true })).toBeVisible();
});

test("expired reviews cannot be confirmed", async ({ page }) => {
  await page.clock.install(); await setup(page); await chooseNamespace(page);
  await page.evaluate(() => { (window as any).__managedState.planLifetime = 1000; });
  await page.getByRole("button", { name: "Edit robot", exact: true }).first().click();
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm save", exact: true })).toBeEnabled();
  await page.clock.runFor(1500);
  await expect(page.getByRole("button", { name: "Confirm save", exact: true })).toBeDisabled();
  expect(await calls(page, "cluster_rbac_user_apply")).toHaveLength(0);
});

test("namespace reset cancels the exact pending snapshot and ignores its late response", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__managedState.deferSnapshot = true; });
  await chooseNamespace(page);
  await expect.poll(async () => (await calls(page, "cluster_rbac_management_snapshot")).length).toBe(1);
  const old = (await calls(page, "cluster_rbac_management_snapshot"))[0].request;
  await page.getByRole("button", { name: "Change user namespace", exact: true }).click();
  await page.getByRole("textbox", { name: "Known user namespace", exact: true }).fill("other");
  await page.getByRole("button", { name: "Use user namespace", exact: true }).click();
  await expect(page.getByRole("table", { name: "Managed users", exact: true })).toContainText("other");
  await page.evaluate(() => { (window as any).__managedState.releaseSnapshot(); });
  await expect(page.getByRole("table", { name: "Managed users", exact: true })).not.toContainText("team");
  expect((await calls(page, "cluster_rbac_management_cancel")).filter(call => call.request.readId === old.readId)).toHaveLength(1);
});

test("unverified access keeps namespace reset available", async ({ page }) => {
  await setup(page, "unknown"); await chooseNamespace(page);
  await expect(page.getByText("Access is unverified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Change user namespace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose a user namespace" })).toBeVisible();
  expect(await calls(page, "cluster_rbac_management_snapshot")).toHaveLength(0);
});

test("read-only classification matches actual rule groups, segments and non-resource verbs", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(async () => {
    const path = "/src/app/cluster/managedUsersApi.ts";
    const api = await import(/* @vite-ignore */ path);
    const base = { apiGroups: [""], resources: ["nodes"], verbs: ["get", "list", "watch"], resourceNames: [], nonResourceURLs: [] };
    const template = { name: "template-cluster-resources___test", uid: "id", resourceVersion: "1", scope: "cluster", rules: [base] };
    const url = { apiGroups: [], resources: [], verbs: ["get"], resourceNames: [], nonResourceURLs: ["/healthz"] };
    const rejected = [{ ...base, apiGroups: ["*"] }, { ...base, resources: ["nodes/*"] }, { ...base, resources: ["custom/proxy/status"] }, { ...base, resources: ["nodes/proxy"] }, { ...url, verbs: ["watch"] }, { ...url, verbs: ["list"] }];
    const malformed = [{ ...base, nonResourceURLs: ["/healthz"] }, { ...base, apiGroups: [] }, { ...base, verbs: [] }, { ...base, resources: [] }, { ...url, resourceNames: ["named"] }, { ...url, apiGroups: [""] }, { ...url, nonResourceURLs: ["healthz"] }];
    const read = { clusterId: "one", sessionId: "session", readId: 1, namespace: "team" };
    const snapshot = { ...read, users: [], templates: [template], truncated: false, fetchedAt: 1 };
    return api.readOnlyTemplate(template) && api.readOnlyTemplate({ ...template, rules: [] }) && api.readOnlyTemplate({ ...template, rules: [url] }) && rejected.every(rule => !api.readOnlyTemplate({ ...template, rules: [rule] })) && malformed.every(rule => { try { api.parseManagementSnapshot({ ...snapshot, templates: [{ ...template, rules: [rule] }] }, read); return false; } catch (reason) { return reason === "invalidResponse"; } });
  })).toBe(true);
});
