import { expect, test, type Page } from "@playwright/test";

type Options = { metrics?: string; malformed?: "negative" | "conditions" | "timestamp"; failedRefresh?: boolean; empty?: boolean };
async function fixture(page: Page, options: Options = {}) {
  page.on("pageerror", (error) => { throw error; });
  await page.addInitScript((options) => {
    let sequence = 0;
    let reads = 0;
    const calls: string[] = [];
    const timestamp = new Date().toISOString();
    const node = {
      roles: ["worker"], taints: 0, version: "v1.35.8-gke.123456789", internalIps: ["10.184.0.89", "2001:db8::1"],
      schedulable: true, diskAllocatable: "100Gi", metricsTimestamp: timestamp,
      cpu: { used: 6.7, allocatable: 23.9, capacity: 24 },
      memory: { used: 8.8 * 1024 ** 3, allocatable: 73.2 * 1024 ** 3, capacity: 80 * 1024 ** 3 },
      conditions: [{ type: "Ready", status: "True" }, { type: "MemoryPressure", status: "False" }, { type: "CustomCondition", status: "Unknown" }],
    };
    if (options.metrics && options.metrics !== "available") {
      node.cpu.used = null as unknown as number; node.memory.used = null as unknown as number;
    }
    if (options.malformed === "negative") node.cpu.used = -1;
    if (options.malformed === "conditions") node.conditions.push({ type: "Ready", status: "True" });
    if (options.malformed === "timestamp") node.metricsTimestamp = "not-a-time";
    Object.assign(window, { isTauri: true, __nodesCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: Record<string, string | number> }) => {
        calls.push(command);
        const request = args?.request ?? {};
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "cluster_session_open" || command === "cluster_connect") return {
          clusterId: request.clusterId, sessionId: request.sessionId ?? `lease-${++sequence}`, contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected",
          apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null,
        };
        if (command === "cluster_disconnect" || command === "cluster_resources_cancel") return;
        if (command === "cluster_resources") {
          if (options.failedRefresh && ++reads > 2) throw "network";
          return { ...request, namespace: null, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: options.metrics ?? "available",
            items: options.empty ? [] : [
              { name: "gke-kaj-prd-cluster-kaj-pool-1-very-long-node-name", status: "Ready", namespace: null,
                createdAt: new Date(Date.now() - 25 * 3600_000).toISOString(), columns: {}, node },
              { name: "gke-kaj-prd-cluster-kaj-pool-2", status: "NotReady", namespace: null, createdAt: null, columns: {},
                node: { ...node, roles: ["control-plane"], taints: 2, internalIps: ["10.184.0.88"], schedulable: false,
                  cpu: { used: 0, allocatable: 15.5, capacity: 16 }, memory: { used: null, allocatable: null, capacity: null },
                  conditions: [{ type: "Ready", status: "False" }, { type: "DiskPressure", status: "True" }] } },
            ] };
        }
        throw "unexpected mock command";
      },
    } });
  }, options);
  await page.setViewportSize({ width: 1563, height: 850 });
  await page.goto("/#/cluster/one?section=nodes");
  if (options.malformed) await expect(page.getByRole("alert")).toContainText("unsupported response");
  else await expect(page.getByRole("table", { name: "Nodes", exact: true })).toBeVisible();
}
const table = (page: Page) => page.getByRole("table", { name: "Nodes", exact: true });
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __nodesCalls: string[] }).__nodesCalls);

test("nodes table renders the reference columns and Rust facts with readable units", async ({ page }, info) => {
  await fixture(page);
  await expect(table(page).getByRole("columnheader")).toHaveText([
    "Name", "CPU", "Memory", "Disk", "Roles", "Taints", "Version", "Internal IP", "Age", "Schedulable", "Conditions",
  ]);
  await expect(page.getByRole("status").filter({ hasText: /^2 items$/ })).toBeVisible();
  const first = table(page).getByRole("row").nth(1);
  await expect(first).toContainText("6.70 / 23.9");
  await expect(first).toContainText("8.8 Gi / 73.2 Gi");
  await expect(first).toContainText("25h");
  await expect(first).toContainText("worker");
  await expect(first).toContainText("10.184.0.89, 2001:db8::1");
  await expect(first).toContainText("MemoryPressure: False");
  await expect(first).toContainText("CustomCondition: Unknown");
  const cpu = first.getByRole("progressbar", { name: /CPU$/ });
  await expect(cpu).toHaveAttribute("aria-valuenow", "6.7");
  await expect(cpu).toHaveAttribute("aria-valuemax", "23.9");
  await expect(cpu).toHaveAttribute("aria-valuetext", /used \/ allocatable/);
  const second = table(page).getByRole("row").nth(2);
  await expect(second).toContainText("0 / 15.5");
  await expect(second).toContainText("Ready: False");
  await expect(second).toContainText("DiskPressure: True");
  await expect(second.getByRole("cell").nth(9)).toHaveText("False");
  await expect(second.getByRole("cell").nth(8)).toHaveText("N/A");
  await expect(first.getByRole("cell").nth(3)).toHaveText("N/A");
  await expect(first.getByRole("cell").nth(3)).not.toContainText("100Gi");
  await expect(first).toContainText("v1.35.8-gke.123456789");
  await page.screenshot({ path: info.outputPath("nodes-table.png") });
});

test("node search is local, case-insensitive, clearable and distinguishes filtered empty", async ({ page }) => {
  await fixture(page);
  const count = (await calls(page)).filter((call) => call === "cluster_resources").length;
  const search = page.getByRole("textbox", { name: "Search nodes", exact: true });
  await search.fill("CONTROL-PLANE");
  await expect(table(page).getByRole("row")).toHaveCount(2);
  await expect(table(page)).toContainText("pool-2");
  await expect(page.getByRole("status").filter({ hasText: /^1 of 2 loaded items$/ })).toBeVisible();
  await search.fill("10.184.0.89");
  await expect(table(page)).toContainText("pool-1");
  await search.fill("missing");
  await expect(table(page)).toContainText("No nodes match your search");
  await expect(table(page)).not.toContainText("No nodes were returned");
  await search.fill("");
  await expect(table(page).getByRole("row")).toHaveCount(3);
  expect((await calls(page)).filter((call) => call === "cluster_resources")).toHaveLength(count);
});

for (const metrics of ["unavailable", "denied", "stale", "partial", "error"]) {
  test(`metrics ${metrics} keeps inventory and never invents usage`, async ({ page }) => {
    await fixture(page, { metrics });
    await expect(table(page)).toContainText("worker");
    await expect(table(page).getByRole("row").nth(1).getByRole("progressbar")).toHaveCount(0);
    await expect(table(page)).toContainText("N/A / 23.9");
    await expect(page.getByRole("status").filter({ hasText: /Node usage metrics/ })).toBeVisible();
  });
}
for (const malformed of ["negative", "conditions", "timestamp"] as const) {
  test(`malformed node ${malformed} fails closed`, async ({ page }) => {
    await fixture(page, { malformed });
    await expect(table(page)).toHaveCount(0);
  });
}

test("failed refresh retains rows and flags the snapshot stale", async ({ page }) => {
  await fixture(page, { failedRefresh: true });
  await page.getByRole("button", { name: "Refresh nodes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not be reached");
  await expect(page.getByRole("status").filter({ hasText: /Previously fetched nodes/ })).toBeVisible();
  await expect(table(page)).toContainText("6.70 / 23.9");
});

test("wide nodes table scrolls internally at narrow widths and zoom", async ({ page }) => {
  await fixture(page);
  for (const width of [360, 640]) {
    await page.setViewportSize({ width, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const region = page.getByRole("group", { name: "Table", exact: true });
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus();
    await page.keyboard.press("End");
    expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  }
});

test("empty inventory is not confused with search or unavailable metrics", async ({ page }) => {
  await fixture(page, { empty: true });
  await expect(table(page)).toContainText("No nodes were returned");
  await expect(page.getByRole("status").filter({ hasText: /^0 items$/ })).toBeVisible();
});
