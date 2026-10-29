import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(() => {
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
      if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev-context", source: "kubeconfig", labels: ["file=/fixtures/config"], color: "#476BA1", status: "disconnected", pinned: true }] };
      if (command === "cluster_permissions_review") {
        const review = args?.request as unknown as { clusterId: string; sessionId: string; readId: number; checks: unknown[] };
        const checkedAt = Date.now();
        return { clusterId: review.clusterId, sessionId: review.sessionId, readId: review.readId,
          authorizationEpoch: `fixture-${review.sessionId}`, revision: review.readId, checkedAt, expiresAt: checkedAt + 30_000,
          items: review.checks.map(check => ({ check, decision: "allowed", reason: null })) };
      }
      if (command === "cluster_permissions_cancel" || command === "cluster_permissions_refresh") return null;
      if (command === "cluster_session_open" || command === "cluster_connect") return { ...args?.request, sessionId: "fixture-session", contextName: "dev-context", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
      if (command === "cluster_resources" && ["nodes", "events"].includes(String(args?.request.kind))) return { ...args?.request, namespace: null, continueToken: null, metrics: null, items: [], truncated: false, fetchedAt: 1793000000000 };
      if (command === "cluster_disconnect" || command === "cluster_resources_cancel") return;
      throw new Error(`Unexpected IPC: ${command}`);
    } } });
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/#/catalog");
  await expect(page.getByRole("table")).toBeVisible();
}

test("Catalog rail keeps constant width without a toggle across workspace entry and exit", async ({ page }) => {
  await fixture(page);
  const catalog = page.locator("#catalog-sidebar");
  const width = (await catalog.boundingBox())!.width;
  expect(width).toBeGreaterThan(0);
  expect(width).toBeLessThanOrEqual(64);
  await expect(catalog).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByRole("button", { name: /^(?:Open|Collapse|Expand) sidebar$/ })).toHaveCount(0);
  await catalog.getByRole("link", { name: "Development", exact: true }).click();
  await expect(catalog).toHaveAttribute("data-collapsed", "true");
  await expect(page.locator(".cluster-sidebar-motion")).toHaveAttribute("data-open", "true");
  await expect(page.getByRole("navigation", { name: "Catalog navigation", exact: true })).toHaveCount(1);
  expect((await catalog.boundingBox())!.width).toBeCloseTo(width, 1);
  await catalog.getByRole("link", { name: "All Categories", exact: true }).click();
  await expect(catalog).toHaveAttribute("data-collapsed", "true");
  await expect(page.locator(".cluster-sidebar-motion")).toHaveCount(0);
  expect((await catalog.boundingBox())!.width).toBeCloseTo(width, 1);
  await expect(page.getByRole("button", { name: /^(?:Open|Collapse|Expand) sidebar$/ })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("iceon.sidebar-collapsed.v1"))).toBeNull();
});

test("reduced motion disables navigation transitions and collapsed groups stay inert", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  await page.locator("#catalog-sidebar").getByRole("link", { name: "Development", exact: true }).click();
  await expect(page.locator("#catalog-sidebar")).toHaveCSS("transition-property", "none");
  await expect(page.locator(".cluster-sidebar-motion")).toHaveCSS("transition-property", "none");
  const nav = page.locator("#cluster-sidebar");
  await nav.getByRole("button", { name: "Expand Workloads", exact: true }).click();
  const pods = nav.getByRole("link", { name: "Pods", exact: true });
  await expect(pods).toBeVisible();
  await nav.getByRole("button", { name: "Collapse Workloads", exact: true }).click();
  await expect(nav.locator('[role="group"][inert]').first()).toHaveCSS("transition-property", "none");
  await expect(pods).toHaveCount(0);
});

test("leaving a cluster retains only an inert exit panel, then removes it", async ({ page }) => {
  await fixture(page);
  await page.locator("#catalog-sidebar").getByRole("link", { name: "Development", exact: true }).click();
  await expect(page.locator(".cluster-sidebar-motion")).toHaveAttribute("data-open", "true");
  const exit = await page.evaluate(async () => {
    const link = document.querySelector<HTMLAnchorElement>('#catalog-sidebar a[aria-label="All Categories"]');
    if (!link) throw new Error("Catalog destination missing");
    link.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const panel = document.querySelector<HTMLElement>(".cluster-sidebar-motion");
    return { open: panel?.dataset.open, inert: panel?.inert, selected: panel?.querySelector('[aria-current="page"]') !== null };
  });
  expect(exit).toEqual({ open: "false", inert: true, selected: false });
  await expect(page.locator(".cluster-sidebar-motion")).toHaveCount(0);
});

test("narrow cluster navigation stays in the drawer beside the Catalog rail", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 360, height: 700 });
  const rail = page.getByRole("main").getByRole("navigation", { name: "Catalog navigation", exact: true });
  await rail.getByRole("link", { name: "Development", exact: true }).click();
  await expect(page.locator("#cluster-sidebar")).toBeHidden();
  const toggle = rail.getByRole("button", { name: "Open sidebar", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator("#cluster-sidebar-drawer")).toBeVisible();
  await expect(drawer.getByRole("navigation", { name: "Catalog navigation", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();
});
