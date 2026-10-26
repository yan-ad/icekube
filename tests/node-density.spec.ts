import { expect, test, type Page } from "@playwright/test";

type Call = { command: string; request: Record<string, unknown> };
async function fixture(page: Page, width = 1563) {
  await page.setViewportSize({ width, height: 850 });
  await page.addInitScript(() => {
    const calls: Call[] = [];
    const usage = { used: 1, allocatable: 4, capacity: 4 };
    const node = {
      roles: ["worker"], taints: 0, version: "v1.35.8", internalIps: ["10.0.0.1"], schedulable: true,
      diskAllocatable: null, metricsTimestamp: null, cpu: usage, memory: usage,
      conditions: [
        { type: "Ready", status: "True" },
        { type: "MemoryPressure", status: "False" },
        { type: "DiskPressure", status: "False" },
        { type: "PIDPressure", status: "False" },
        { type: "NetworkUnavailable", status: "False" },
        ...Array.from({ length: 30 }, (_, index) => ({ type: `CustomCondition${index}`, status: index % 2 ? "True" : "Unknown" })),
      ],
    };
    const common = { namespace: null, createdAt: null, resourceVersion: "1", columns: {} };
    const items = [
      { ...common, name: "worker-density-a-long-node-name", uid: "uid-a", status: "Ready", node },
      { ...common, name: "worker-density-b", uid: "uid-b", status: "NotReady", node: { ...node,
        conditions: node.conditions.map(condition => condition.type === "Ready" ? { ...condition, status: "False" }
          : ["MemoryPressure", "DiskPressure", "PIDPressure", "NetworkUnavailable"].includes(condition.type) ? { ...condition, status: "True" } : condition) } },
      { ...common, name: "worker-density-unknown", uid: "uid-unknown", status: "Unknown", node: { ...node,
        conditions: [{ type: "Ready", status: "Unknown" }, { type: "CustomHealthy", status: "True" }] } },
    ];
    Object.assign(window, { isTauri: true, __densityCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
        const request = args?.request ?? {};
        calls.push({ command, request });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "cluster_session_open" || command === "cluster_connect") return {
          clusterId: request.clusterId, sessionId: request.sessionId ?? "lease-density", contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: "v1.35.8", error: null,
        };
        if (["cluster_disconnect", "cluster_resources_cancel", "cluster_resource_detail_cancel"].includes(command)) return;
        if (command === "cluster_resources") return { ...request, namespace: null, items, truncated: false, continueToken: null, fetchedAt: Date.now(), metrics: "available" };
        if (command === "cluster_resource_detail") {
          const reference = request.reference as { name: string };
          return { ...request, item: items.find(item => item.name === reference.name), related: {} };
        }
        throw "notFound";
      },
    } });
  });
  await page.goto("/#/cluster/one?section=nodes");
  await expect(grid(page)).toBeVisible();
}
const grid = (page: Page) => page.getByRole("table", { name: "Nodes", exact: true });
const row = (page: Page, index: number) => grid(page).getByRole("row").nth(index + 1);
const cell = async (page: Page, index: number, label: string) => {
  const labels = await grid(page).getByRole("columnheader").allTextContents();
  return row(page, index).getByRole("cell").nth(labels.findIndex(text => text.trim() === label));
};
const conditions = (page: Page, index: number) => row(page, index).getByRole("cell").filter({ has: page.getByRole("button", { name: /\+\d+ conditions/ }) });
const viewport = (page: Page) => page.locator("[data-icekube-table-viewport]").filter({ has: grid(page) });

test("35 conditions keep single-line compact rows, visible initial names and bounded badges", async ({ page }) => {
  await fixture(page);
  for (let index = 0; index < 3; index++) expect((await row(page, index).boundingBox())!.height).toBeLessThanOrEqual(80);
  expect(await viewport(page).evaluate(element => element.scrollLeft)).toBe(0);
  const name = row(page, 0).getByRole("button", { name: "worker-density-a-long-node-name", exact: true });
  await expect(name).toBeInViewport();
  expect((await (await cell(page, 0, "Name")).boundingBox())!.width).toBeGreaterThanOrEqual(250);
  await expect(conditions(page, 0).locator(".astryx-badge")).toHaveCount(1);
  await expect(conditions(page, 0)).toHaveText("Ready+34 conditions");
  await expect(conditions(page, 0)).not.toContainText("CustomCondition");
  await expect(conditions(page, 1).locator(".astryx-badge[data-variant=warning]")).toHaveCount(4);
  await expect(conditions(page, 1).locator(".astryx-badge[data-variant=error]")).toHaveText("Ready: False");
  await expect(conditions(page, 1).getByRole("button")).toHaveText("+30 conditions");
  await expect(conditions(page, 2)).toHaveText("Ready: Unknown+1 conditions");
  await expect(row(page, 0)).toContainText("worker");
  await expect(row(page, 0)).toContainText("1.00 / 4.00");
  const adverseCell = conditions(page, 1);
  await adverseCell.scrollIntoViewIfNeeded();
  const bounds = await adverseCell.boundingBox();
  const summary = adverseCell.getByRole("button", { name: "+30 conditions", exact: true });
  const summaryBounds = await summary.boundingBox();
  expect(summaryBounds!.x + summaryBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  for (const badge of await adverseCell.locator(".astryx-badge").all()) {
    const badgeBounds = await badge.boundingBox();
    expect(Math.abs(badgeBounds!.y - summaryBounds!.y)).toBeLessThan(12);
  }
});

test("additional conditions button opens the exact node inspector without selecting or expanding rows", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 1563, height: 420 });
  const more = conditions(page, 0).getByRole("button", { name: "+34 conditions", exact: true });
  await more.scrollIntoViewIfNeeded();
  await more.click();
  const inspector = page.getByRole("region", { name: "Resource details", exact: true });
  await expect(inspector).toContainText("Node: worker-density-a-long-node-name");
  await expect(inspector).toContainText("CustomCondition29: True");
  await expect(inspector).toContainText("MemoryPressure: False");
  await expect(inspector.locator(".astryx-badge").filter({ hasText: /^(Ready|MemoryPressure|DiskPressure|PIDPressure|NetworkUnavailable|CustomCondition)/ })).toHaveCount(36);
  expect(await inspector.evaluate(element => {
    const scroll = [...element.querySelectorAll("*")].find(candidate => ["auto", "scroll"].includes(getComputedStyle(candidate).overflowY) && candidate.scrollHeight > candidate.clientHeight);
    if (!scroll) return false;
    scroll.scrollTop = scroll.scrollHeight;
    return scroll.scrollTop > 0;
  })).toBe(true);
  const calls = await page.evaluate(() => (window as unknown as { __densityCalls: Call[] }).__densityCalls);
  expect(calls.find(call => call.command === "cluster_resource_detail")?.request.reference).toEqual({ kind: "nodes", namespace: null, name: "worker-density-a-long-node-name", uid: "uid-a" });
  await expect(grid(page).getByRole("row")).toHaveCount(4);
  await expect(row(page, 0).getByRole("checkbox")).not.toBeChecked();
});

test("node name is keyboard activatable independently of selection", async ({ page }) => {
  await fixture(page);
  await row(page, 2).getByRole("button", { name: "worker-density-unknown", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toContainText("Node: worker-density-unknown");
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toContainText("CustomHealthy: True");
  await expect(row(page, 2).getByRole("checkbox")).not.toBeChecked();
});

for (const width of [360, 640]) test(`narrow ${width} table scrolls internally and supports keyboard inspection`, async ({ page }) => {
  await fixture(page, width);
  const region = viewport(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await region.evaluate(element => element.scrollLeft)).toBe(0);
  await expect(row(page, 0).getByRole("button", { name: "worker-density-a-long-node-name", exact: true })).toBeInViewport();
  await region.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  const more = conditions(page, 1).getByRole("button", { name: "+30 conditions", exact: true });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toContainText("Node: worker-density-b");
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toContainText("NetworkUnavailable: True");
  expect((await row(page, 1).boundingBox())!.height).toBeLessThanOrEqual(80);
});
