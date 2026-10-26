import { expect, test, type Page } from "@playwright/test";

type Call = { command: string; request: Record<string, any> };
type SearchWindow = Window & { __searchCalls: Call[]; __releaseSearch: () => void };

async function fixture(page: Page, section: string, count: number) {
  await page.addInitScript(({ count }) => {
    const calls: Call[] = [];
    const held: (() => void)[] = [];
    let session = 0;
    Object.assign(window, { isTauri: true, __searchCalls: calls,
      __releaseSearch: () => held.splice(0).forEach(resolve => resolve()),
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Record<string, any> }) => {
        const r = args?.request ?? {};
        calls.push({ command, request: r });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "cluster_session_open" || command === "cluster_connect") return {
          clusterId: r.clusterId, sessionId: r.sessionId ?? `lease-${++session}`, contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: "v1.35.8", error: null,
        };
        if (command === "cluster_resources") {
          if (r.query === "held") await new Promise<void>(resolve => held.push(resolve));
          const usage = { used: null, allocatable: null, capacity: null };
          return { ...r, namespace: null, continueToken: null, truncated: false, metrics: null, fetchedAt: Date.now(),
            items: r.kind === "namespaces" ? [] : Array.from({ length: r.query ? 1 : count }, (_, i) => ({
              name: r.query || `resource-${i}`, uid: `uid-${i}`, resourceVersion: "1", namespace: r.kind === "nodes" ? null : "team-a",
              createdAt: null, columns: {}, status: "Running", node: r.kind === "nodes" ? {
                roles: [], taints: 0, version: null, internalIps: [], schedulable: true, diskAllocatable: null, metricsTimestamp: null,
                cpu: usage, memory: usage, conditions: [],
              } : null,
            })) };
        }

        if (command === "helm_table") return { ...r, truncated: false, items: Array.from({ length: count }, (_, i) => ({
          id: `chart-${i}`, name: `repo/chart-${i}`, namespace: null, version: "1.0.0", appVersion: "1", description: "Cached chart", status: null, revision: null, updated: null,
        })) };
        if (command === "helm_cancel") return null;
        if (["cluster_disconnect", "cluster_resources_cancel"].includes(command)) return null;
        throw "unexpected search fixture command";
      } },
    });
  }, { count });
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto(`/#/cluster/one?section=${section}`);
}
const reads = (page: Page, kind: string) => page.evaluate(kind => (window as SearchWindow).__searchCalls.filter(c => c.command === "cluster_resources" && c.request.kind === kind), kind);

test("500 cached Helm charts filter locally without extra Rust reads", async ({ page }) => {
  await fixture(page, "helm-charts", 500);
  const grid = page.getByRole("table", { name: "Helm Charts", exact: true });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("row")).toHaveCount(501);
  const before = await page.evaluate(() => (window as SearchWindow).__searchCalls.filter(c => c.command === "helm_table").length);
  const input = page.getByRole("textbox", { name: "Search Charts", exact: true });
  await input.pressSequentially("abcdefghijklmnopqrst");
  await expect(input).toHaveValue("abcdefghijklmnopqrst");
  await expect(grid).toContainText("No charts match your filters.");
  expect(await page.evaluate(() => (window as SearchWindow).__searchCalls.filter(c => c.command === "helm_table").length)).toBe(before);
});

for (const count of [100]) for (const [section, kind, label] of [["pods", "pods", "Pods"], ["nodes", "nodes", "Nodes"]]) {
  test(`${label}: ${count} retained rows coalesce a 20-character typing burst`, async ({ page }) => {
    await fixture(page, section, count);
    const grid = page.getByRole("table", { name: label, exact: true });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole("row")).toHaveCount(count + 1);
    const before = (await reads(page, kind)).length;
    const input = page.getByRole("textbox", { name: `Search ${label}`, exact: false });
    await input.pressSequentially("abcdefghijklmnopqrst");
    await expect(input).toHaveValue("abcdefghijklmnopqrst");
    await expect.poll(async () => (await reads(page, kind)).length).toBe(before + 1);
    await expect(grid).toContainText("abcdefghijklmnopqrst");
    const after = await reads(page, kind);
    expect(after.slice(before).map(call => call.request.query)).toEqual(["abcdefghijklmnopqrst"]);
    expect(after.at(-1)!.request.continueToken).toBeNull();
  });
}

for (const [section, kind, label] of [["pods", "pods", "Pods"], ["nodes", "nodes", "Nodes"]]) {
  test(`${label}: edits clear selection and cancel a held read before debounce completes`, async ({ page }) => {
    await fixture(page, section, 100);
    const grid = page.getByRole("table", { name: label, exact: true });
    await expect(grid).toBeVisible();
    await grid.getByRole("checkbox").nth(1).click();
    await expect(page.getByRole("button", { name: "Delete selected resources", exact: true })).toBeVisible();
    const input = page.getByRole("textbox", { name: `Search ${label}`, exact: false });
    await input.fill("held");
    await expect(page.getByRole("button", { name: "Delete selected resources", exact: true })).toHaveCount(0);
    await expect.poll(async () => (await reads(page, kind)).some(call => call.request.query === "held")).toBe(true);
    const held = (await reads(page, kind)).at(-1)!.request;
    await input.fill("final");
    await expect.poll(() => page.evaluate(held => (window as SearchWindow).__searchCalls.some(call => call.command === "cluster_resources_cancel" && call.request.readId === held.readId && call.request.sessionId === held.sessionId), held)).toBe(true);
    await page.evaluate(() => (window as SearchWindow).__releaseSearch());
    await expect(grid).not.toContainText("held");
    await expect(grid).toContainText("final");
    await expect(grid.getByRole("checkbox").nth(1)).not.toBeChecked();
  });
}
