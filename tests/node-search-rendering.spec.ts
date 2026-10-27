import { expect, test } from "@playwright/test";

type SearchWindow = Window & { __nodeRenders: number; __nodeQueries: (string | null)[] };

test("Nodes retains its dense table without rendering it for each draft character", async ({ page, context }) => {
  page.on("pageerror", error => { throw error; });
  // Count the real component body, not DOM mutations: React can render a whole
  // unchanged table without changing any DOM nodes.
  await page.route("**/src/app/cluster/NodesTable.tsx*", async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = "const { openResource } = useResourceInspector();";
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker,
      `${marker}\nwindow.__nodeRenders = (window.__nodeRenders ?? 0) + 1;`) });
  });
  await page.addInitScript(() => {
    const queries: (string | null)[] = [];
    Object.assign(window, { isTauri: true, __nodeRenders: 0, __nodeQueries: queries,
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Record<string, any> }) => {
        const request = args?.request ?? {};
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "fixture", contextName: "fixture", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: "one", sessionId: request.sessionId ?? "lease", contextName: "fixture", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: "v1.35.8", error: null };
        if (command === "cluster_resources") {
          queries.push(request.query ?? null);
          const usage = { used: 1, allocatable: 4, capacity: 4 };
          return { ...request, namespace: null, continueToken: request.query ? null : "next", truncated: false, metrics: "available", fetchedAt: Date.now(),
            items: Array.from({ length: request.query ? 1 : 100 }, (_, index) => ({ name: request.query || `node-${index}`, uid: `uid-${index}`, namespace: null, resourceVersion: "1", createdAt: null, columns: {}, status: "Ready",
              node: { roles: ["worker"], taints: 0, version: "v1.35.8", internalIps: ["192.0.2.1"], schedulable: true, diskAllocatable: null, metricsTimestamp: null, cpu: usage, memory: usage,
                conditions: [{ type: "Ready", status: "True" }] } })) };
        }
        if (["cluster_disconnect", "cluster_resources_cancel"].includes(command)) return null;
        throw `Unexpected fixture command: ${command}`;
      } },
    });
  });
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.install();
  await page.goto("/#/cluster/one?section=nodes");
  const grid = page.getByRole("table", { name: "Nodes", exact: true });
  await expect(grid.getByRole("row")).toHaveCount(101);
  await expect(page.getByRole("button", { name: "Refresh nodes", exact: true })).toBeEnabled();
  await grid.getByRole("checkbox").nth(1).click();
  await expect(page.getByRole("button", { name: "Delete selected resources", exact: true })).toBeVisible();
  await page.clock.pauseAt(new Date());
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const input = page.getByRole("textbox", { name: "Search nodes", exact: true });
  await input.pressSequentially("a");
  await expect(page.getByRole("button", { name: "Delete selected resources", exact: true })).toHaveCount(0);
  await expect(grid.getByRole("checkbox").nth(1)).not.toBeChecked();
  await expect(grid.getByRole("checkbox").nth(1)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next nodes page", exact: true })).toBeDisabled();
  const before = await page.evaluate(() => ({ renders: (window as SearchWindow).__nodeRenders, queries: (window as SearchWindow).__nodeQueries.length }));
  await input.pressSequentially("bcdefghijklmnopqrst");
  await expect(input).toHaveValue("abcdefghijklmnopqrst");
  expect(await page.evaluate(() => (window as SearchWindow).__nodeRenders)).toBe(before.renders);
  expect(await page.evaluate(() => (window as SearchWindow).__nodeQueries.length)).toBe(before.queries);
  await expect(grid.getByRole("row")).toHaveCount(101);
  await page.clock.fastForward(160);
  await page.clock.resume();
  await expect(grid.getByRole("row")).toHaveCount(2);
  await expect(grid).toContainText("abcdefghijklmnopqrst");
  await expect(grid.getByRole("checkbox").nth(1)).toBeEnabled();
  await grid.getByRole("checkbox").nth(1).click();
  await expect(page.getByRole("button", { name: "Delete selected resources", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as SearchWindow).__nodeQueries.slice(-1))).toEqual(["abcdefghijklmnopqrst"]);
  await cdp.detach();
});
