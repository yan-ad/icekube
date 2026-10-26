import { expect, test, type Page } from "@playwright/test";
import { resourceViews } from "../src/app/cluster/resourceViews";

type Fixture = Window & { __resizeCalls: { command: string; request: Record<string, unknown> }[]; __releaseResize: () => void };
const inspector = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });
const handle = (page: Page) => page.getByRole("separator", { name: "Resize resource details" });
const workspace = (page: Page) => page.locator('[aria-label="Resource workspace"]');
const width = async (page: Page) => (await inspector(page).boundingBox())!.width;

async function fixture(page: Page, hold = false) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(({ views, hold }) => {
    const calls: Fixture["__resizeCalls"] = [];
    let release = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    const item = (kind: string) => ({ name: kind === "namespaces" ? "team-a" : "sample-a", namespace: kind === "namespaces" ? null : "team-a",
      uid: `uid-${kind}`, resourceVersion: "version-1", createdAt: "2026-10-01T00:00:00Z", status: "Active",
      columns: Object.fromEntries((views.find(view => view.kind === kind)?.columns ?? []).map(column => [column.key, "1"])), node: null });
    Object.assign(window, { isTauri: true, __resizeCalls: calls, __releaseResize: release,
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
        const request = structuredClone(args?.request ?? {}); calls.push({ command, request });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "cluster_session_open" || command === "cluster_connect") return {
          clusterId: "one", sessionId: request.sessionId ?? "resize-lease", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected",
          apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null,
        };
        if (["cluster_disconnect", "cluster_resources_cancel", "cluster_resource_detail_cancel", "helm_cancel"].includes(command)) return null;
        if (command === "cluster_resources") return { ...request, namespace: request.namespace ?? null, items: [item(String(request.kind))], continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null };
        if (command === "cluster_resource_detail") {
          if (hold) await pending;
          return { ...request, item: item("deployments"), related: {} };
        }
        if (command === "cluster_pod_forward_list") return [];
        throw `Unexpected resize fixture command: ${command}`;
      } },
    });
  }, { views: resourceViews, hold });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/cluster/one?section=deployments");
  await page.getByRole("table", { name: "Deployments", exact: true }).getByRole("button", { name: "sample-a", exact: true }).click();
  await expect(inspector(page)).toBeVisible();
}

async function expectReflow(page: Page) {
  const main = (await workspace(page).boundingBox())!, panel = (await inspector(page).boundingBox())!;
  expect(main.width).toBeGreaterThan(0);
  expect(Math.abs(main.x + main.width - panel.x)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("opening, dragging and expanding reflow the workspace, restore retains the dragged width", async ({ page }) => {
  await fixture(page);
  await expect(inspector(page)).toContainText("version-1");
  await expect(handle(page)).toHaveAttribute("aria-orientation", "vertical");
  await page.waitForTimeout(220);
  await expectReflow(page);
  const before = await width(page), box = (await handle(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down(); await page.mouse.move(box.x - 80, box.y + 100); await page.mouse.up();
  const dragged = await width(page);
  expect(dragged).toBeGreaterThan(before + 50);
  await expectReflow(page);
  await inspector(page).getByRole("button", { name: "Expand inspector", exact: true }).click();
  await page.waitForTimeout(220);
  expect(await width(page)).toBeGreaterThan(dragged);
  await expectReflow(page);
  await inspector(page).getByRole("button", { name: "Restore inspector width", exact: true }).click();
  await expect.poll(async () => Math.abs(await width(page) - dragged)).toBeLessThan(2);
  await inspector(page).getByRole("button", { name: "Refresh details", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).__resizeCalls.filter(call => call.command === "cluster_resource_detail").length)).toBeGreaterThan(1);
});

test("separator keyboard bounds and reduced motion remain usable on narrow windows", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  await page.setViewportSize({ width: 560, height: 800 });
  await handle(page).focus(); await handle(page).press("Home");
  await expect.poll(async () => Number(await handle(page).getAttribute("aria-valuenow"))).toBeLessThanOrEqual(45);
  const minimum = await width(page);
  await handle(page).press("ArrowRight");
  expect(await width(page)).toBeGreaterThan(minimum);
  await handle(page).press("End"); await expect(handle(page)).toHaveAttribute("aria-valuenow", "75");
  await handle(page).press("ArrowLeft"); await expect(handle(page)).toHaveAttribute("aria-valuenow", "73");
  await handle(page).press("ArrowRight"); await expect(handle(page)).toHaveAttribute("aria-valuenow", "75");
  expect(await inspector(page).evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
  await expectReflow(page);
});

test("close immediately disposes pending content while an empty inert shell collapses", async ({ page }) => {
  await fixture(page, true);
  await expect(inspector(page)).toContainText("Loading resource details");
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  await expect(inspector(page)).toHaveCount(0);
  const shell = page.locator(".resource-inspector");
  await expect(shell).toHaveAttribute("inert", "");
  await expect(shell).toBeEmpty();
  await expect.poll(() => page.evaluate(() => { const calls = (window as unknown as Fixture).__resizeCalls;
    return calls.filter(call => call.command === "cluster_resource_detail").every(read => calls.some(call => call.command === "cluster_resource_detail_cancel" && call.request.readId === read.request.readId)); })).toBe(true);
  await page.evaluate(() => (window as unknown as Fixture).__releaseResize());
  await expect.poll(async () => (await shell.boundingBox())!.width).toBeLessThanOrEqual(1);
  await expect(inspector(page)).toHaveCount(0);
});

test("pointer cancellation and route disposal end dragging without late detail revival", async ({ page }) => {
  await fixture(page, true);
  await page.waitForTimeout(220);
  const box = (await handle(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down();
  await expect(inspector(page)).toHaveAttribute("data-dragging", "true");
  await handle(page).dispatchEvent("pointercancel", { pointerId: 1 });
  await expect(inspector(page)).toHaveAttribute("data-dragging", "false");
  await page.mouse.up();
  await page.evaluate(() => { location.hash = "/catalog/all"; });
  await expect(page.locator(".resource-inspector")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Fixture).__releaseResize());
  await expect.poll(() => page.evaluate(() => { const calls = (window as unknown as Fixture).__resizeCalls;
    return calls.filter(call => call.command === "cluster_resource_detail").every(read => calls.some(call => call.command === "cluster_resource_detail_cancel" && call.request.readId === read.request.readId)); })).toBe(true);
  await expect(inspector(page)).toHaveCount(0);
});
