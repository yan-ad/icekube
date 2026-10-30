import { expect, test, type Page } from "@playwright/test";
import { resourceViews } from "../src/app/cluster/resourceViews";

async function fixture(page: Page) {
  await page.addInitScript(({ views }) => {
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
        const request = args?.request ?? {};
        if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
          authorizationEpoch: String(request.sessionId), revision: 0, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
          items: (request.checks as unknown[]).map(check => ({ check, decision: "allowed", reason: null })) };
        if (command === "cluster_permissions_cancel" || command === "cluster_permissions_refresh") return null;
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "cluster_session_open" || command === "cluster_connect") return {
          clusterId: request.clusterId, sessionId: request.sessionId ?? "lease-layout", contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null,
        };
        if (command === "cluster_resources_cancel" || command === "cluster_disconnect") return;
        if (command !== "cluster_resources") throw `Unexpected mock command: ${command}`;
        if (request.kind === "namespaces") return { ...request, namespace: null, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null,
          items: [{ name: "team-a", namespace: null, status: "Active", createdAt: null, columns: {}, node: null }] };
        const view = views.find(view => view.kind === request.kind)!;
        return { ...request, namespace: request.namespace ?? null, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null,
          items: Array.from({ length: 100 }, (_, index) => ({
            name: `resource-${index}`, namespace: "team-a", status: "Active", createdAt: "2026-01-01T00:00:00Z", node: null,
            columns: Object.fromEntries(view.columns.map(column => [column.key, `fact-${column.key}`])),
          })),
        };
      },
    } });
  }, { views: resourceViews });
  await page.goto("/#/cluster/one?section=resource-quotas");
  await expect(page.getByRole("table", { name: "Resource Quotas", exact: true }).getByRole("row")).toHaveCount(101);
}

for (const width of [1440, 480]) {
  test(`table scrolls on both axes with a sticky header at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await fixture(page);
    // Force a wide inventory at desktop size too, independently of column content.
    await page.getByRole("table", { name: "Resource Quotas", exact: true }).evaluate(el => { el.style.minWidth = "2200px"; });
    const viewport = page.locator("[data-iceon-table-viewport]");
    const toolbar = page.getByRole("region", { name: "Resource Quotas filters", exact: true });
    const header = page.getByRole("columnheader").first();
    const initialToolbar = (await toolbar.boundingBox())!;
    const initialHeader = (await header.boundingBox())!;
    expect(await viewport.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await viewport.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await viewport.hover();
    await page.mouse.wheel(0, 350);
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
    await page.mouse.wheel(250, 0);
    await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await viewport.evaluate(el => { el.scrollTop = 650; el.scrollLeft = 120; });
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBe(650);
    await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBe(120);
    const afterHeader = (await header.boundingBox())!;
    const afterToolbar = (await toolbar.boundingBox())!;
    expect(Math.abs(afterHeader.y - initialHeader.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterToolbar.y - initialToolbar.y)).toBeLessThanOrEqual(1);
    expect(afterHeader.y).toBeGreaterThanOrEqual(afterToolbar.y + afterToolbar.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`toolbar controls reflow without clipping at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await fixture(page);
    const toolbar = page.getByRole("region", { name: "Resource Quotas filters", exact: true });
    const search = page.getByRole("textbox", { name: "Search Resource Quotas", exact: true });
    const status = page.getByRole("combobox", { name: "Status", exact: true });
    const titleBox = (await toolbar.getByText("Resource Quotas", { exact: true }).boundingBox())!;
    const count = toolbar.getByText("100 items", { exact: true });
    const countBox = (await count.boundingBox())!;
    const searchBox = (await search.boundingBox())!;
    const statusBox = (await status.boundingBox())!;
    expect(Math.abs(titleBox.y + titleBox.height / 2 - countBox.y - countBox.height / 2)).toBeLessThanOrEqual(2);
    if (width === 1440) {
      expect(Math.abs(searchBox.y + searchBox.height / 2 - statusBox.y - statusBox.height / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(titleBox.y + titleBox.height / 2 - searchBox.y - searchBox.height / 2)).toBeLessThanOrEqual(2);
    } else {
      expect(statusBox.y).toBeGreaterThanOrEqual(searchBox.y + searchBox.height);
    }
    const toolbarBox = (await toolbar.boundingBox())!;
    for (const box of [titleBox, countBox, searchBox, statusBox]) {
      expect(box.x).toBeGreaterThanOrEqual(toolbarBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(toolbarBox.x + toolbarBox.width);
      expect(box.y + box.height).toBeLessThanOrEqual(toolbarBox.y + toolbarBox.height);
    }
    expect(await toolbar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await search.focus();
    await expect(search).toBeInViewport();
    await status.focus();
    await expect(status).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
