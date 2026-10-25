import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
});

type Options = {
  connectDelay?: number;
  openDelay?: number;
  resourceDelay?: number;
  cancelError?: string;
  resourceError?: string;
  refreshError?: string;
  connectError?: string;
  connectSnapshotError?: string;
  reorderedOpens?: boolean;
  staleConnectOnce?: boolean;
  truncated?: boolean;
  empty?: boolean;
  mismatch?: boolean;
  responseReadId?: number | string | null;
  clusterName?: string;
  contextName?: string;
};

test("delayed disposed opens cannot invalidate the live StrictMode connection", async ({ page }) => {
  await fixture(page, { reorderedOpens: true, openDelay: 100, connectDelay: 250 });
  await expect(page.getByRole("main")).toContainText("API version: v1.34.1");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await callList(page)).filter((call) => call.command === "cluster_connect")).toHaveLength(1);
});

for (const retry of ["refresh", "connect"] as const) {
  test(`stale session ${retry} obtains a new lease before connecting`, async ({ page }) => {
    await fixture(page, { staleConnectOnce: true });
    await expect(page.getByRole("alert")).toContainText("Connection error [staleSession]");
    const before = await callList(page);
    if (retry === "refresh") await page.getByRole("button", { name: "Refresh cluster", exact: true }).click();
    else await menuAction(page, "Connect to cluster");
    await expect(page.getByRole("main")).toContainText("API version: v1.34.1");
    await expect(page.getByRole("alert")).toHaveCount(0);
    const next = (await callList(page)).slice(before.length);
    expect(next.map((call) => call.command)).toEqual(["cluster_disconnect", "cluster_session_open", "cluster_connect"]);
    expect(next[2].request.sessionId).not.toBe(before.find((call) => call.command === "cluster_connect")!.request.sessionId);
  });
}

async function fixture(page: Page, options: Options = {}) {
  await page.addInitScript((options) => {
    const calls: { command: string; request: Record<string, string | number> }[] = [];
    let sequence = 0;
    let resourceCalls = 0;
    let connectCalls = 0;
    let openCalls = 0;
    let activeLease: string | number | null = null;
    const clusters = ["one", "two"].map((id) => ({
      id,
      name: id === "one" ? (options.clusterName ?? "Development") : "Staging",
      contextName: id === "one" ? (options.contextName ?? `${id}-context`) : `${id}-context`,
      source: "kubeconfig",
      status: "disconnected",
      pinned: true,
      labels: ["file=/fixtures/config"],
      color: "#476BA1",
    }));
    Object.assign(window, {
      isTauri: true,
      __connectionCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: { request: Record<string, string | number> }) => {
          const request = args?.request ?? {};
          calls.push({ command, request });
          const snapshot = {
            clusterId: request.clusterId,
            sessionId: request.sessionId ?? `lease-${++sequence}`,
            contextName: `${request.clusterId}-context`,
            status: "disconnected",
            apiVersion: null as string | null,
            error: null,
          };
          if (command === "catalog_list") return { revision: 1, discoveryError: null, clusters, webLinks: [] };
          if (command === "cluster_session_open") {
            const openCall = ++openCalls;
            if (options.openDelay && (!options.reorderedOpens || openCall === 1)) await new Promise((resolve) => setTimeout(resolve, options.openDelay));
            activeLease = snapshot.sessionId;
            return snapshot;
          }
          if (command === "cluster_disconnect") {
            if (activeLease === request.sessionId) activeLease = null;
            return;
          }
          if (command === "cluster_resources_cancel") {
            if (options.cancelError) throw options.cancelError;
            return;
          }
          if (command === "cluster_connect") {
            connectCalls++;
            if (options.connectDelay) await new Promise((resolve) => setTimeout(resolve, options.connectDelay));
            if (options.staleConnectOnce && connectCalls === 1) activeLease = null;
            if ((options.reorderedOpens || options.staleConnectOnce) && activeLease !== request.sessionId) throw "staleSession";
            if (options.connectError) throw options.connectError;
            if (options.connectSnapshotError && connectCalls === 1) return { ...snapshot, status: "error", error: options.connectSnapshotError };
            return { ...snapshot, status: "connected", apiVersion: "v1.34.1" };
          }
          if (command === "cluster_resources") {
            const resourceCall = ++resourceCalls;
            if (options.resourceDelay) await new Promise((resolve) => setTimeout(resolve, options.resourceDelay));
            if (options.resourceError && request.kind === "nodes") throw options.resourceError;
            if (options.refreshError && resourceCall > 2) throw options.refreshError;
            return {
              clusterId: options.mismatch ? "other" : request.clusterId,
              sessionId: request.sessionId,
              kind: request.kind,
              readId: options.responseReadId === undefined ? request.readId : options.responseReadId,
              items: options.empty ? [] : [{ name: `${request.clusterId}-${request.kind}`, status: request.kind === "nodes" ? "Ready" : "Active" }],
              truncated: options.truncated ?? false,
              fetchedAt: 1790000000000,
            };
          }
          throw "unexpected mock command";
        },
      },
    });
  }, options);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/#/cluster/one");
  await expect(page.getByRole("heading", { level: 2, name: "Cluster", exact: true })).toBeVisible();
  if (options.openDelay && !options.reorderedOpens) await expect(page.getByRole("main")).toContainText("Opening…");
  else if (options.connectDelay) await expect(page.getByRole("main")).toContainText("Connecting…");
  else if (options.connectError || options.connectSnapshotError || options.staleConnectOnce) await expect(page.getByRole("alert")).toBeVisible();
  else await expect(page.getByRole("main")).toContainText("API version: v1.34.1");
}

const callList = (page: Page) => page.evaluate(() => (window as unknown as { __connectionCalls: { command: string; request: Record<string, string | number> }[] }).__connectionCalls);
const section = (page: Page, name: string) => page.getByRole("navigation", { name: "Cluster navigation", exact: true }).getByRole("link", { name, exact: true }).click();
const actions = (page: Page) => page.getByRole("button", { name: "Cluster actions", exact: true });
const menuAction = async (page: Page, name: string) => {
  await actions(page).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
};

for (const [code, detail] of [
  ["tlsFailed", "The cluster TLS connection could not be verified"],
  ["unsupportedAuth", "authentication method that is not supported yet"],
  ["insecureTransport", "insecure transport configuration"],
  ["authFailed", "Cluster authentication failed"],
  ["network", "The cluster could not be reached"],
  ["timeout", "request timed out"],
  ["permissionDenied", "Kubernetes permissions"],
  ["kubeconfigInvalid", "selected context is invalid"],
] as const) {
  test(`automatic ${code} error explains the cause without retrying`, async ({ page }) => {
    await fixture(page, { connectSnapshotError: code });
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(`Connection error [${code}]:`);
    await expect(alert).toContainText(detail);
    await expect(page.getByRole("button", { name: "Connect to cluster", exact: true })).toHaveCount(0);
    const first = await callList(page);
    expect(first.filter((call) => call.command === "cluster_connect")).toHaveLength(1);
    await page.waitForTimeout(150);
    expect((await callList(page)).filter((call) => call.command === "cluster_connect")).toHaveLength(1);
    await page.setViewportSize({ width: 360, height: 320 });
    await alert.scrollIntoViewIfNeeded();
    await expect(alert).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.getByRole("button", { name: "Refresh cluster", exact: true }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByRole("main")).toContainText("API version: v1.34.1");
  });
}

test("workspace entry opens and automatically connects exactly once under StrictMode", async ({ page }) => {
  await fixture(page);
  const calls = await callList(page);
  expect(calls.filter((call) => call.command === "cluster_session_open").length).toBeGreaterThanOrEqual(1);
  expect(calls.filter((call) => call.command === "cluster_connect")).toHaveLength(1);
  const live = calls.find((call) => call.command === "cluster_connect")!.request;
  expect(calls.some((call) => call.command === "cluster_disconnect" && call.request.sessionId === live.sessionId)).toBe(false);
});

test("section navigation does not reconnect and resource navigation cancels the exact read first", async ({ page }) => {
  await fixture(page, { resourceDelay: 250 });
  const initial = await callList(page);
  await section(page, "Nodes");
  await expect(page.getByRole("main")).toContainText("Loading nodes");
  const before = await callList(page);
  const previous = before.filter((call) => call.command === "cluster_resources").at(-1)!.request;
  await section(page, "Namespaces");
  await expect(page.getByRole("main")).toContainText("Loading namespaces");
  const next = (await callList(page)).slice(before.length);
  expect(next[0]).toEqual({ command: "cluster_resources_cancel", request: previous });
  expect(next[1].command).toBe("cluster_resources");
  expect(next[1].request).toEqual({ ...previous, kind: "namespaces", readId: next[1].request.readId });
  expect(next[1].request.readId).toBeGreaterThan(previous.readId as number);
  expect((await callList(page)).filter((call) => call.command === "cluster_connect")).toHaveLength(1);
  expect(initial.filter((call) => call.command === "cluster_connect")).toHaveLength(1);
});

test("toolbar cluster refresh releases, reopens, and connects, while resource refresh cancels first", async ({ page }) => {
  await fixture(page);
  await section(page, "Nodes");
  await expect(page.getByRole("table", { name: "Nodes", exact: true })).toContainText("one-nodes");
  const before = await callList(page);
  const resource = before.filter((call) => call.command === "cluster_resources").at(-1)!.request;
  await page.getByRole("button", { name: "Refresh nodes", exact: true }).click();
  const resourceNext = (await callList(page)).slice(before.length);
  expect(resourceNext[0]).toEqual({ command: "cluster_resources_cancel", request: resource });
  expect(resourceNext[1].command).toBe("cluster_resources");
  await section(page, "Cluster");
  const clusterBefore = await callList(page);
  await page.getByRole("button", { name: "Refresh cluster", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("API version: v1.34.1");
  const clusterNext = (await callList(page)).slice(clusterBefore.length);
  expect(clusterNext.map((call) => call.command)).toEqual(["cluster_disconnect", "cluster_session_open", "cluster_connect"]);
});

test("Meta+r and Control+r refresh the scoped workspace without document reload or metadata scan", async ({ page }) => {
  await fixture(page);
  await section(page, "Nodes");
  await expect(page.getByRole("table", { name: "Nodes", exact: true })).toContainText("one-nodes");
  const before = await callList(page);
  const catalogCount = before.filter((call) => call.command === "catalog_list").length;
  const urlBefore = page.url();
  await page.evaluate(() => Object.assign(window, { __documentMarker: "same-document" }));
  for (const shortcut of ["Meta+r", "Control+r"]) {
    const previous = await callList(page);
    const request = previous.filter((call) => call.command === "cluster_resources").at(-1)!.request;
    await page.keyboard.press(shortcut);
    await expect.poll(async () => (await callList(page)).length).toBe(previous.length + 2);
    const next = (await callList(page)).slice(previous.length);
    expect(next[0]).toEqual({ command: "cluster_resources_cancel", request });
    expect(next[1].command).toBe("cluster_resources");
    expect(next[1].request).toEqual({ ...request, readId: next[1].request.readId });
    expect(next[1].request.readId).toBeGreaterThan(request.readId as number);
  }
  expect(await page.evaluate(() => (window as unknown as { __documentMarker: string }).__documentMarker)).toBe("same-document");
  expect(page.url()).toBe(urlBefore);
  expect((await callList(page)).slice(before.length).every((call) => ["cluster_resources_cancel", "cluster_resources"].includes(call.command))).toBe(true);
  expect((await callList(page)).filter((call) => call.command === "catalog_list")).toHaveLength(catalogCount);
});

test("refresh shortcut ignores repeat, modifiers, and composing, and is disabled while connecting", async ({ page }) => {
  await fixture(page, { connectDelay: 400 });
  await expect(page.getByRole("button", { name: "Refresh cluster", exact: true })).toBeDisabled();
  await page.keyboard.press("Control+r");
  await page.keyboard.press("Meta+r");
  expect((await callList(page)).filter((call) => call.command === "cluster_connect")).toHaveLength(1);
  await expect(page.getByRole("main")).toContainText("API version: v1.34.1");
  const initial = await callList(page);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, repeat: true, bubbles: true })));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, altKey: true, bubbles: true })));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, shiftKey: true, bubbles: true })));
  await page.evaluate(() => { const event = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true }); Object.defineProperty(event, "isComposing", { value: true }); window.dispatchEvent(event); });
  expect((await callList(page)).length).toBe(initial.length);
});

test("canceling automatic connection leaves the workspace disconnected until explicit refresh", async ({ page }) => {
  await fixture(page, { connectDelay: 450 });
  await menuAction(page, "Cancel connection");
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: /^Disconnected$/ })).toHaveText("Disconnected");
  await page.waitForTimeout(550);
  expect((await callList(page)).filter((call) => call.command === "cluster_connect")).toHaveLength(1);
  const calls = await callList(page);
  const previous = calls.find((call) => call.command === "cluster_connect")!.request;
  expect(calls.some((call) => call.command === "cluster_disconnect" && call.request.sessionId === previous.sessionId)).toBe(true);
  await section(page, "Nodes");
  await expect(page.getByRole("main")).toContainText("Refresh to reconnect");
  expect((await callList(page)).filter((call) => call.command === "cluster_resources")).toHaveLength(0);
  await page.getByRole("button", { name: "Refresh nodes", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("API version: v1.34.1");
});

test("cluster actions menu exposes connection and metadata actions, and Escape closes it", async ({ page }) => {
  await fixture(page);
  await actions(page).click();
  await expect(page.getByRole("menu")).toContainText("Disconnect");
  await expect(page.getByRole("menu")).toContainText("Show saved metadata");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(actions(page)).toBeFocused();
  await actions(page).click();
  await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: /^Disconnected$/ })).toHaveText("Disconnected");
  await menuAction(page, "Show saved metadata");
  await actions(page).click();
  await expect(page.getByRole("menuitem", { name: "Connect to cluster", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Refresh cluster", exact: true })).toBeEnabled();
  expect((await callList(page)).filter((call) => call.command === "cluster_connect")).toHaveLength(1);
  await page.getByRole("button", { name: "Refresh cluster", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("API version: v1.34.1");
});

test("metadata toggle and Catalog breadcrumb are keyboard reachable and preserve focus", async ({ page }, testInfo) => {
  await fixture(page, { clusterName: "A very long Development cluster name that should remain compact", contextName: "A very long context identifier" });
  const catalog = page.getByRole("link", { name: "Catalog", exact: true });
  await catalog.focus();
  await expect(catalog).toBeFocused();
  await catalog.press("Enter");
  await expect(page).toHaveURL(/#\/catalog/);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
  await actions(page).click();
  await page.getByRole("menuitem", { name: "Show saved metadata", exact: true }).click();
  await expect(page.getByText("Saved metadata", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 700 });
  await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: testInfo.outputPath("long-cluster-360.png") });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.screenshot({ path: testInfo.outputPath("long-cluster-1200.png") });
});

test("browser preview does not auto-connect or scan native metadata", async ({ page }) => {
  await page.addInitScript(() => { Object.assign(window, { isTauri: false }); });
  await page.goto("/#/cluster/one");
  await expect(page.getByRole("heading", { level: 1, name: "Desktop engine required", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Browser preview cannot read the local catalog.");
});

test("resource actions preserve empty and truncated states", async ({ page }) => {
  await fixture(page, { empty: true, truncated: true });
  await section(page, "Nodes");
  await expect(page.getByRole("table", { name: "Nodes", exact: true })).toContainText("No nodes were returned");
  await expect(page.getByRole("main")).toContainText("This is not the total");
  await section(page, "Namespaces");
  await expect(page.getByRole("table", { name: "Namespaces", exact: true })).toContainText("No namespaces were returned");
});
