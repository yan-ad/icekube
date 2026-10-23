import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, options: { failOpen?: boolean; empty?: boolean; slow?: boolean } = {}) {
  await page.addInitScript((options) => {
    const calls: { command: string; request?: Record<string, unknown> }[] = [];
    const state = {
      revision: 1, discoveryError: null,
      clusters: options.empty ? [] : [
        { id: "cluster-one", name: "Development", contextName: "dev-context", source: "kubeconfig", labels: ["file=/fixtures/config"], color: "#476BA1", status: "disconnected", pinned: true },
        { id: "cluster-two", name: "Staging", contextName: "stage-context", source: "kubeconfig", labels: ["file=/fixtures/config"], color: "#659040", status: "disconnected", pinned: true },
      ],
      webLinks: [{ id: "link-one", name: "Documentation", url: "https://docs.example.test/", source: "local", labels: [], color: "#EAA40B", pinned: true }],
    };
    Object.assign(window, {
      isTauri: true, __activationCalls: calls,
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
        calls.push({ command, request: args?.request });
        if (options.slow) await new Promise((resolve) => setTimeout(resolve, 250));
        if (command === "cluster_session_open") return { clusterId: args?.request.clusterId, sessionId: crypto.randomUUID(), contextName: "dev-context", status: "disconnected", apiVersion: null, error: null };
        if (command === "cluster_connect") return { clusterId: args?.request.clusterId, sessionId: args?.request.sessionId, contextName: "dev-context", status: "connected", apiVersion: "v1.34.1", error: null };
        if (command === "cluster_resources") return { clusterId: args?.request.clusterId, sessionId: args?.request.sessionId, kind: args?.request.kind, readId: args?.request.readId, items: [], truncated: false, fetchedAt: Date.now() };
        if (command === "cluster_disconnect") return;
        if (command === "catalog_open_web_link") {
          if (options.failOpen) throw "openFailed";
          return;
        }
        if (command === "catalog_set_pin") {
          const item = [...state.clusters, ...state.webLinks].find((item) => item.id === args?.request.id);
          if (item) item.pinned = !!args?.request.pinned;
          state.revision++;
        }
        return structuredClone(state);
      } },
    });
  }, options);
  await page.setViewportSize({ width: 1200, height: 800 });
}

async function calls(page: Page) {
  return page.evaluate(() => (window as unknown as { __activationCalls: { command: string; request?: Record<string, unknown> }[] }).__activationCalls);
}

test("cluster row opens inset workspace and auto-collapses without changing catalog preference", async ({ page }, testInfo) => {
  await fixture(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
  await page.getByRole("row", { name: "Open cluster Development", exact: true }).getByRole("cell", { name: "kubeconfig", exact: true }).click();
  await expect(page).toHaveURL(/#\/cluster\/cluster-one$/);
  await expect(page.getByRole("heading", { name: "Development", level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("icekube.sidebar-collapsed.v1"))).toBe("false");
  const inset = page.getByRole("navigation", { name: "Cluster navigation", exact: true });
  await expect(inset).toBeVisible();
  await expect(inset.getByRole("link", { name: "Nodes", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Connected");
  await page.screenshot({ path: testInfo.outputPath("cluster-workspace.png") });
  for (const [name, section] of [["Nodes", "nodes"], ["Workloads", "workloads"], ["Network", "network"], ["Storage", "storage"], ["Helm", "helm"]]) {
    await inset.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`section=${section}$`));
    await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(section === "nodes" ? "No nodes were returned" : "not implemented yet");
  }
  expect((await calls(page)).every((call) => ["catalog_list", "cluster_session_open", "cluster_connect", "cluster_disconnect"].includes(call.command))).toBe(true);
  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await expect(page.getByRole("table", { name: "All Categories", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Cluster navigation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
});

test("row Enter/Space and pinned cluster activation work; pin/remove buttons do not activate rows", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Unpin Development", exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog$/);
  await page.getByRole("button", { name: "Remove Development", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/#\/catalog$/);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  const row = page.getByRole("row", { name: "Open cluster Development", exact: true });
  await row.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/cluster\/cluster-one$/);
  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await row.focus(); await page.keyboard.press("Space");
  await expect(page).toHaveURL(/cluster\/cluster-one$/);
  await page.getByRole("navigation", { name: "Catalog navigation", exact: true }).getByRole("link", { name: "Staging", exact: true }).click();
  await expect(page).toHaveURL(/cluster\/cluster-two$/);
  await expect(page.getByRole("heading", { name: "Staging", level: 1, exact: true })).toBeVisible();
});

test("web-link rows and pinned links delegate saved ID to Rust without navigation", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  const row = page.getByRole("row", { name: "Open web link Documentation", exact: true });
  await row.getByRole("cell", { name: "local", exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog$/);
  await expect.poll(async () => (await calls(page)).filter((call) => call.command === "catalog_open_web_link").length).toBe(1);
  await row.focus(); await page.keyboard.press("Enter");
  await expect.poll(async () => (await calls(page)).filter((call) => call.command === "catalog_open_web_link").length).toBe(2);
  await page.getByRole("navigation", { name: "Catalog navigation", exact: true }).getByRole("button", { name: "Documentation", exact: true }).click();
  await expect.poll(async () => (await calls(page)).filter((call) => call.command === "catalog_open_web_link").length).toBe(3);
  expect((await calls(page)).filter((call) => call.command === "catalog_open_web_link").every((call) => JSON.stringify(call.request) === JSON.stringify({ id: "link-one" }))).toBe(true);
  await page.getByRole("button", { name: "Unpin Documentation", exact: true }).click();
  expect((await calls(page)).filter((call) => call.command === "catalog_open_web_link").length).toBe(3);
});

test("OS browser opening failure is visible and leaves catalog usable", async ({ page }) => {
  await fixture(page, { failOpen: true });
  await page.goto("/");
  await page.getByRole("row", { name: "Open web link Documentation", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("alert")).toContainText("default browser");
  await expect(page).toHaveURL(/#\/catalog$/);
  await expect(page.getByRole("row", { name: "Open cluster Development", exact: true })).toBeVisible();
});

test("direct missing cluster route does not select another cluster", async ({ page }) => {
  await fixture(page);
  await page.goto("/#/cluster/missing");
  await expect(page.getByRole("main").getByRole("heading", { name: "Cluster not found", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("heading", { name: "Development", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
});

test("cluster navigation is available in the narrow-window drawer", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto("/#/cluster/cluster-one");
  await expect(page.getByRole("heading", { level: 1, name: "Development", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("navigation", { name: "Cluster navigation", exact: true })).toBeVisible();
  await dialog.getByRole("navigation", { name: "Cluster navigation", exact: true }).getByRole("link", { name: "Events", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 2, name: "Events", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("workspace sidebar expansion is temporary and history preserves section scope", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await page.getByRole("row", { name: "Open cluster Development", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("icekube.sidebar-collapsed.v1"))).toBe("false");
  await page.getByRole("navigation", { name: "Cluster navigation", exact: true }).getByRole("link", { name: "Nodes", exact: true }).click();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page).toHaveURL(/cluster\/cluster-one$/);
  await page.getByRole("button", { name: "Go forward", exact: true }).click();
  await expect(page).toHaveURL(/section=nodes$/);
  await page.getByRole("navigation", { name: "Catalog navigation", exact: true }).getByRole("link", { name: "Staging", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
});

test("pending web-link opens are serialized and never launch from Pin/Remove", async ({ page }) => {
  await fixture(page, { slow: true });
  await page.goto("/");
  const row = page.getByRole("row", { name: "Open web link Documentation", exact: true });
  await expect(page.getByRole("button", { name: "Unpin Documentation", exact: true })).toBeEnabled();
  await row.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect.poll(async () => (await calls(page)).filter((call) => call.command === "catalog_open_web_link").length).toBe(1);
  await expect(page.getByRole("button", { name: "Unpin Documentation", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Remove Documentation", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await calls(page)).filter((call) => call.command === "catalog_open_web_link").length).toBe(1);
});
