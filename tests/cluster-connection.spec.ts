import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
});

type Options = { connectDelay?: number; openDelay?: number; resourceDelay?: number; cancelError?: string; resourceError?: string; refreshError?: string; connectError?: string; truncated?: boolean; empty?: boolean; mismatch?: boolean; responseReadId?: number | string | null };
async function fixture(page: Page, options: Options = {}) {
  await page.addInitScript((options) => {
    const calls: { command: string; request: Record<string, string | number> }[] = [];
    let sequence = 0;
    let resourceCalls = 0;
    const clusters = ["one", "two"].map((id) => ({ id, name: id === "one" ? "Development" : "Staging", contextName: `${id}-context`, source: "kubeconfig", status: "disconnected", pinned: true, labels: ["file=/fixtures/config"], color: "#476BA1" }));
    Object.assign(window, { isTauri: true, __connectionCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: Record<string, string | number> }) => {
        const request = args?.request ?? {};
        calls.push({ command, request });
        const snapshot = { clusterId: request.clusterId, sessionId: request.sessionId ?? `lease-${++sequence}`, contextName: `${request.clusterId}-context`, status: "disconnected", apiVersion: null as string | null, error: null };
        if (command === "catalog_list") return { revision: 1, discoveryError: null, clusters, webLinks: [] };
        if (command === "cluster_session_open") {
          if (options.openDelay) await new Promise((resolve) => setTimeout(resolve, options.openDelay));
          return snapshot;
        }
        if (command === "cluster_disconnect") return;
        if (command === "cluster_resources_cancel") {
          if (options.cancelError) throw options.cancelError;
          return;
        }
        if (command === "cluster_connect") {
          if (options.connectDelay) await new Promise((resolve) => setTimeout(resolve, options.connectDelay));
          if (options.connectError) throw options.connectError;
          return { ...snapshot, status: "connected", apiVersion: "v1.34.1" };
        }
        if (command === "cluster_resources") {
          const resourceCall = ++resourceCalls;
          if (options.resourceDelay) await new Promise((resolve) => setTimeout(resolve, options.resourceDelay));
          if (options.resourceError && request.kind === "nodes") throw options.resourceError;
          if (options.refreshError && resourceCall > 2) throw options.refreshError;
          return { clusterId: options.mismatch ? "other" : request.clusterId, sessionId: request.sessionId, kind: request.kind, readId: options.responseReadId === undefined ? request.readId : options.responseReadId, items: options.empty ? [] : [{ name: `${request.clusterId}-${request.kind}`, status: request.kind === "nodes" ? "Ready" : "Active" }], truncated: options.truncated ?? false, fetchedAt: 1790000000000 };
        }
        throw "unexpected mock command";
      },
    } });
  }, options);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/#/cluster/one");
  if (options.openDelay) await expect(page.getByRole("heading", { level: 1, name: "Development", exact: true })).toBeVisible();
  else await expect(page.getByRole("button", { name: "Connect to cluster", exact: true })).toBeEnabled();
}
const callList = (page: Page) => page.evaluate(() => (window as unknown as { __connectionCalls: { command: string; request: Record<string, string | number> }[] }).__connectionCalls);
const connect = (page: Page) => page.getByRole("button", { name: "Connect to cluster", exact: true }).click();
const section = (page: Page, name: string) => page.getByRole("navigation", { name: "Cluster navigation", exact: true }).getByRole("link", { name, exact: true }).click();

test("section navigation disposes the previous resource request before loading the next section", async ({ page }) => {
  await fixture(page, { resourceDelay: 450 });
  await connect(page); await section(page, "Nodes");
  await expect(page.getByRole("main")).toContainText("Loading nodes");
  const before = await callList(page);
  const previous = before.filter((call) => call.command === "cluster_resources").at(-1)!.request;
  await section(page, "Namespaces");
  await expect(page.getByRole("main")).toContainText("Loading namespaces");
  const next = (await callList(page)).slice(before.length);
  const replacement = next[1].request;
  expect(next[0]).toEqual({ command: "cluster_resources_cancel", request: previous });
  expect(next[1]).toEqual({ command: "cluster_resources", request: { ...previous, kind: "namespaces", readId: replacement.readId } });
  expect(Number.isSafeInteger(replacement.readId)).toBe(true);
  expect(replacement.readId).toBeGreaterThan(previous.readId as number);
  await expect(page.getByRole("table", { name: "Namespaces", exact: true })).toContainText("one-namespaces");
  await expect(page.getByRole("main")).not.toContainText("one-nodes");
  const mountedCalls = await callList(page);
  const activeRequest = mountedCalls.filter((call) => call.command === "cluster_resources").at(-1)!.request;
  const reads = mountedCalls.filter((call) => call.command === "cluster_resources").map((call) => call.request.readId as number);
  expect(reads.every((readId) => Number.isSafeInteger(readId) && readId > 0)).toBe(true);
  expect(reads.every((readId, index) => index === 0 || readId > reads[index - 1])).toBe(true);
  const beforeUnmount = mountedCalls.length;
  await section(page, "Cluster");
  expect((await callList(page)).slice(beforeUnmount)).toEqual([
    { command: "cluster_resources_cancel", request: activeRequest },
  ]);
});

test("refresh dispatches disposal before the replacement read and ignores cancellation failure", async ({ page }) => {
  await fixture(page, { cancelError: "network" });
  await connect(page); await section(page, "Nodes");
  await expect(page.getByRole("table", { name: "Nodes", exact: true })).toContainText("one-nodes");
  const before = await callList(page);
  const request = before.filter((call) => call.command === "cluster_resources").at(-1)!.request;
  await page.getByRole("button", { name: "Refresh nodes", exact: true }).click();
  await expect(page.getByRole("table", { name: "Nodes", exact: true })).toHaveAttribute("aria-busy", "false");
  const next = (await callList(page)).slice(before.length);
  const replacement = next[1].request;
  expect(next).toEqual([
    { command: "cluster_resources_cancel", request },
    { command: "cluster_resources", request: { ...request, readId: replacement.readId } },
  ]);
  expect(Number.isSafeInteger(replacement.readId)).toBe(true);
  expect(replacement.readId).toBeGreaterThan(request.readId as number);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const beforeUnmount = (await callList(page)).length;
  await section(page, "Cluster");
  expect((await callList(page)).slice(beforeUnmount)).toEqual([
    { command: "cluster_resources_cancel", request: replacement },
  ]);
});

for (const responseReadId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER, "1", null]) {
  test(`resource response rejects invalid or mismatched read identity ${JSON.stringify(responseReadId)}`, async ({ page }) => {
    await fixture(page, { responseReadId });
    await connect(page); await section(page, "Nodes");
    await expect(page.getByRole("alert")).toContainText("unsupported response");
    await expect(page.getByRole("table")).toHaveCount(0);
  });
}

test("refresh failure labels retained rows stale and redacts unknown resource errors", async ({ page }) => {
  await fixture(page, { refreshError: "SECRET resource failure" });
  await connect(page); await section(page, "Nodes");
  await expect(page.getByRole("table", { name: "Nodes", exact: true })).toContainText("one-nodes");
  await page.getByRole("button", { name: "Refresh nodes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No connection or resource result has been assumed");
  await expect(page.getByRole("main")).toContainText("may be stale");
  await expect(page.getByRole("main")).not.toContainText("SECRET");
  await expect(page.getByRole("table")).toContainText("one-nodes");
});

test("disconnect while a resource request is pending clears the table and ignores late rows", async ({ page }) => {
  await fixture(page, { resourceDelay: 450 });
  await connect(page); await section(page, "Nodes");
  await expect(page.getByRole("main")).toContainText("Loading nodes");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.waitForTimeout(550);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect to cluster", exact: true })).toBeEnabled();
});

test("opening and section navigation never connect implicitly; explicit connect loads independently scoped tables", async ({ page }) => {
  await fixture(page, { truncated: true });
  await section(page, "Nodes");
  expect((await callList(page)).filter((call) => ["cluster_connect", "cluster_resources"].includes(call.command))).toEqual([]);
  await connect(page);
  await expect(page.getByRole("table", { name: "Nodes", exact: true })).toContainText("one-nodes");
  await expect(page.getByRole("main")).toContainText("This is not the total");
  await section(page, "Namespaces");
  await expect(page.getByRole("table", { name: "Namespaces", exact: true })).toContainText("one-namespaces");
  await section(page, "Cluster");
  await expect(page.getByRole("main")).toContainText("API version: v1.34.1");
  const calls = await callList(page);
  expect(calls.filter((call) => call.command === "cluster_connect")).toHaveLength(1);
  // Strict Mode may replay resource effects, but each request remains section-specific.
  expect([...new Set(calls.filter((call) => call.command === "cluster_resources").map((call) => call.request.kind))]).toEqual(["nodes", "namespaces"]);
  expect(calls.filter((call) => call.command === "cluster_connect" || call.command === "cluster_resources").every((call) => call.request.clusterId === "one" && !!call.request.sessionId)).toBe(true);
});

test("node RBAC denial does not block namespaces, unknown native messages are redacted", async ({ page }) => {
  await fixture(page, { resourceError: "permissionDenied" });
  await connect(page); await section(page, "Nodes");
  await expect(page.getByRole("alert")).toContainText("Kubernetes permissions");
  await section(page, "Namespaces");
  await expect(page.getByRole("table", { name: "Namespaces", exact: true })).toBeVisible();
});

test("unknown connect exceptions never render raw native strings", async ({ page }) => {
  await fixture(page, { connectError: "SECRET token=do-not-render /private/credentials" });
  await connect(page);
  await expect(page.getByRole("alert")).toContainText("No connection or resource result has been assumed");
  await expect(page.getByRole("main")).not.toContainText("SECRET");
});

test("cancel wins a late connect completion and releases only the old lease", async ({ page }) => {
  await fixture(page, { connectDelay: 450 });
  await section(page, "Nodes"); await connect(page);
  await page.getByRole("button", { name: "Cancel connection", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect to cluster", exact: true })).toBeEnabled();
  await page.waitForTimeout(550);
  await expect(page.getByRole("table")).toHaveCount(0);
  const calls = await callList(page);
  const previous = calls.find((call) => call.command === "cluster_connect")!.request;
  expect(calls.some((call) => call.command === "cluster_disconnect" && call.request.sessionId === previous.sessionId && call.request.clusterId === previous.clusterId)).toBe(true);
  expect(calls.filter((call) => call.command === "cluster_resources")).toHaveLength(0);
});

test("cross-cluster late responses never appear in the next workspace", async ({ page }) => {
  await fixture(page, { resourceDelay: 450 });
  await connect(page); await section(page, "Nodes");
  await expect(page.getByRole("main")).toContainText("Loading nodes");
  await page.getByRole("navigation", { name: "Catalog navigation", exact: true }).getByRole("link", { name: "Staging", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Staging", exact: true })).toBeVisible();
  await page.waitForTimeout(550);
  await expect(page.getByRole("main")).not.toContainText("one-nodes");
  await expect(page.getByRole("table")).toHaveCount(0);
  expect((await callList(page)).some((call) => call.command === "cluster_disconnect" && call.request.clusterId === "one")).toBe(true);
});

test("navigation disposal releases a lease even when session open completes late", async ({ page }) => {
  await fixture(page, { openDelay: 300 });
  await page.getByRole("button", { name: "Back to Catalog", exact: true }).click();
  await page.waitForTimeout(450);
  const calls = await callList(page);
  expect(calls.filter((call) => call.command === "cluster_session_open").length).toBeGreaterThanOrEqual(1);
  const releases = calls.filter((call) => call.command === "cluster_disconnect");
  expect(releases.length).toBe(calls.filter((call) => call.command === "cluster_session_open").length);
  expect(new Set(releases.map((call) => call.request.sessionId)).size).toBe(releases.length);
});

test("resource loading keeps Refresh and Disconnect operable; mismatched responses are rejected", async ({ page }) => {
  await fixture(page, { resourceDelay: 350, mismatch: true });
  await connect(page); await section(page, "Nodes");
  await expect(page.getByRole("button", { name: "Refresh nodes", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText("unsupported response");
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect to cluster", exact: true })).toBeEnabled();
});

test("narrow viewport keyboard connection, resource navigation and empty state", async ({ page }, testInfo) => {
  await fixture(page, { empty: true });
  await page.setViewportSize({ width: 360, height: 700 });
  await page.getByRole("button", { name: "Connect to cluster", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toContainText("API version: v1.34.1");
  await page.getByRole("button", { name: "Open sidebar", exact: true }).focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("link", { name: "Namespaces", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("table", { name: "Namespaces", exact: true })).toContainText("No namespaces were returned");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: testInfo.outputPath("narrow-cluster-resources.png") });
  await page.getByRole("button", { name: "Disconnect", exact: true }).focus(); await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Connect to cluster", exact: true })).toBeEnabled();
});
