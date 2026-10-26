import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(() => {
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
      if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev-context", source: "kubeconfig", labels: ["file=/fixtures/config"], color: "#476BA1", status: "disconnected", pinned: true }] };
      if (command === "cluster_session_open" || command === "cluster_connect") return { ...args?.request, sessionId: "fixture-session", contextName: "dev-context", status: "disconnected", apiVersion: null, error: null };
      if (command === "cluster_disconnect") return;
      throw new Error(`Unexpected IPC: ${command}`);
    } } });
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/#/catalog");
  await expect(page.getByRole("table")).toBeVisible();
}

test("Catalog width transitions preserve its preference across workspace entry and exit", async ({ page }) => {
  await fixture(page);
  const catalog = page.locator("#catalog-sidebar");
  const expanded = await catalog.evaluate(el => el.getBoundingClientRect().width);
  await expect(catalog).toHaveCSS("transition-property", "width");
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(catalog).toHaveAttribute("data-collapsed", "true");
  await expect.poll(() => catalog.evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(expanded);
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await catalog.getByRole("link", { name: "Development", exact: true }).click();
  await expect(catalog).toHaveAttribute("data-collapsed", "true");
  await expect(page.locator(".cluster-sidebar-motion")).toHaveAttribute("data-open", "true");
  await expect(page.getByRole("navigation", { name: "Catalog navigation", exact: true })).toHaveCount(1);
  await catalog.getByRole("link", { name: "All Categories", exact: true }).click();
  await expect(catalog).toHaveAttribute("data-collapsed", "false");
  await expect(page.locator(".cluster-sidebar-motion")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("icekube.sidebar-collapsed.v1"))).toBe("false");
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
