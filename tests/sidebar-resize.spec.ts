import { expect, test, type Page } from "@playwright/test";
import { defaultPreferences } from "../src/app/preferences/api";

const storageKey = "astryx-resizable:iceon.cluster-sidebar-width.v1";
const handle = (page: Page) => page.getByRole("separator", { name: "Resize workspace sidebar", exact: true });
const sidebar = (page: Page) => page.locator(".cluster-sidebar-motion");
const width = async (page: Page) => (await sidebar(page).boundingBox())!.width;

async function fixture(page: Page, theme: "light" | "dark" = "light", saved?: string, blockStorage = false) {
  page.on("pageerror", error => { throw error; });
  page.on("console", message => { if (message.type() === "error") throw new Error(message.text()); });
  await page.addInitScript(({ defaults, theme, saved, blockStorage, storageKey }) => {
    if (saved !== undefined && !sessionStorage.getItem("sidebar-resize-seeded")) {
      localStorage.setItem(storageKey, saved);
      sessionStorage.setItem("sidebar-resize-seeded", "true");
    }
    if (blockStorage) {
      Storage.prototype.getItem = () => { throw new DOMException("Storage disabled", "SecurityError"); };
      Storage.prototype.setItem = () => { throw new DOMException("Storage disabled", "SecurityError"); };
    }
    Object.assign(window, { isTauri: true, __prefCalls: [], __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
      const request = args?.request ?? {};
      if (command === "preferences_get") return { revision: 1, preferences: { ...defaults, app: { ...defaults.app, theme } } };
      if (command === "route_history_get" || command === "route_history_save") return null;
      if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: ["one", "two"].map(id => ({
        id, name: `Development ${id}`, contextName: `dev-${id}`, source: "kubeconfig", labels: [], color: "#476BA1", status: "disconnected", pinned: true,
      })) };
      if (command === "cluster_permissions_review") return { ...request, authorizationEpoch: "fixture", revision: request.readId,
        checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
        items: (request.checks as unknown[]).map(check => ({ check, decision: "allowed", reason: null })) };
      if (command === "cluster_session_open" || command === "cluster_connect") return { ...request, sessionId: `session-${request.clusterId}`,
        contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: "v1.35.8", error: null };
      if (command === "cluster_resources") return { ...request, namespace: request.namespace ?? null, items: [], continueToken: null, metrics: null, truncated: false, fetchedAt: Date.now() };
      if (["cluster_permissions_cancel", "cluster_permissions_refresh", "cluster_resources_cancel", "cluster_disconnect"].includes(command)) return null;
      throw new Error(`Unexpected sidebar fixture IPC: ${command}`);
    } } });
  }, { defaults: defaultPreferences, theme, saved, blockStorage, storageKey });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/cluster/one?section=overview");
  await expect(handle(page)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.getByRole("heading", { name: "Cluster overview", exact: true })).toBeVisible();
}

async function drag(page: Page, delta: number) {
  const box = (await handle(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const nav = (await sidebar(page).boundingBox())!;
  const main = (await page.getByRole("main").boundingBox())!;
  expect(Math.abs(main.x - nav.x - nav.width)).toBeLessThanOrEqual(2);
  expect(main.width).toBeGreaterThan(300);
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: dragging resizes immediately, preserves the Catalog rail and persists across routes/reload`, async ({ page }) => {
    await fixture(page, theme);
    const rail = page.locator("#catalog-sidebar");
    const railWidth = (await rail.boundingBox())!.width;
    const initial = await width(page);
    await drag(page, 100);
    const resized = await width(page);
    expect(resized).toBeCloseTo(initial + 100, 0);
    expect((await rail.boundingBox())!.width).toBeCloseTo(railWidth, 1);
    expect(await sidebar(page).evaluate(element => getComputedStyle(element).transitionProperty)).not.toContain("width");
    await noOverflow(page);
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).size, storageKey)).toBeCloseTo(resized, 0);
    await rail.getByRole("link", { name: "All Categories", exact: true }).click();
    await expect(handle(page)).toHaveCount(0);
    await expect(sidebar(page)).toHaveCount(0);
    await rail.getByRole("link", { name: "Development two", exact: true }).click();
    await expect(handle(page)).toBeVisible();
    expect(await width(page)).toBeCloseTo(resized, 0);
    await page.reload();
    await expect(handle(page)).toBeVisible();
    expect(await width(page)).toBeCloseTo(resized, 0);
    await drag(page, -80);
    expect(await width(page)).toBeCloseTo(resized - 80, 0);
    await noOverflow(page);
    await handle(page).focus();
    await page.keyboard.press("ArrowRight");
    const contrast = await handle(page).evaluate(element => {
      const style = getComputedStyle(element);
      const sample = document.createElement("section");
      sample.style.color = "var(--color-background-body)";
      document.body.append(sample);
      const colors = [style.outlineColor, getComputedStyle(sample).color];
      sample.remove();
      const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
        .map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const [low, high] = colors.map(luminance).sort((a, b) => a - b);
      return (high + 0.05) / (low + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: test.info().outputPath(`sidebar-${theme}.png`) });
  });
}

test("keyboard resizing exposes the pane, focus and live bounds", async ({ page }) => {
  await fixture(page);
  await expect(handle(page)).toHaveAttribute("aria-controls", "cluster-sidebar");
  await expect(handle(page)).toHaveAttribute("aria-orientation", "vertical");
  await page.locator("#cluster-sidebar").getByRole("button", { name: "Pin Custom Resources for Development one", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(handle(page)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const enlarged = await width(page);
  await page.keyboard.press("ArrowLeft");
  expect(await width(page)).toBeLessThan(enlarged);
  await page.keyboard.press("Home");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "176");
  expect(await width(page)).toBe(176);
  await page.keyboard.press("ArrowLeft");
  expect(await width(page)).toBe(176);
  await page.keyboard.press("End");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "480");
  expect(await width(page)).toBe(480);
  await page.keyboard.press("ArrowRight");
  expect(await width(page)).toBe(480);
  await expect(handle(page)).toBeFocused();
  expect(await handle(page).evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Tab");
  await expect(handle(page)).not.toBeFocused();
  await noOverflow(page);
});

test("enlarged text, fullscreen-sized layout and disposal during drag stay bounded", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await handle(page).press("End");
  await noOverflow(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(handle(page)).toBeVisible();
  expect(await width(page)).toBeLessThanOrEqual(480);
  await noOverflow(page);
  const box = (await handle(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(handle(page)).toHaveAttribute("data-resizing", "true");
  await page.evaluate(() => { location.hash = "/catalog/all"; });
  await expect(handle(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(sidebar(page)).toHaveCount(0);
  await page.locator("#catalog-sidebar").getByRole("link", { name: "Development one", exact: true }).click();
  await expect(handle(page)).toBeVisible();
  await drag(page, -50);
  expect(await width(page)).toBeCloseTo(430, 0);
  await noOverflow(page);
});

test("pointer bounds and cancellation release the resize gesture", async ({ page }) => {
  await fixture(page);
  await drag(page, 700);
  expect(await width(page)).toBe(480);
  await drag(page, -700);
  expect(await width(page)).toBe(176);
  const box = (await handle(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(handle(page)).toHaveAttribute("data-resizing", "true");
  await handle(page).locator(":scope > *").first().dispatchEvent("pointercancel", { pointerId: 1 });
  await expect(handle(page)).not.toHaveAttribute("data-resizing", "true");
  await page.mouse.up();
  await drag(page, 50);
  expect(await width(page)).toBeCloseTo(226, 0);
});

test("viewport bounds, narrow drawer and reduced motion preserve navigation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  await handle(page).press("End");
  await page.setViewportSize({ width: 800, height: 700 });
  await expect.poll(() => width(page)).toBe(280);
  await expect(handle(page)).toHaveAttribute("aria-valuemax", "280");
  await expect(sidebar(page)).toHaveCSS("transition-property", "none");
  await noOverflow(page);
  await page.setViewportSize({ width: 360, height: 700 });
  await expect(handle(page)).toBeHidden();
  const toggle = page.locator("#catalog-sidebar-narrow").getByRole("button", { name: "Open sidebar", exact: true });
  await toggle.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.locator("#cluster-sidebar-drawer")).toBeVisible();
  await expect(drawer.getByRole("separator", { name: /Resize/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(handle(page)).toBeVisible();
  expect(await width(page)).toBeGreaterThanOrEqual(176);
  await noOverflow(page);
});

for (const saved of ["not-json", '{"size":99999}', '{"size":-100}', '{"size":"wide"}']) {
  test(`invalid or out-of-range saved width is safe: ${saved}`, async ({ page }) => {
    await fixture(page, "light", saved);
    expect(await width(page)).toBeGreaterThanOrEqual(176);
    expect(await width(page)).toBeLessThanOrEqual(480);
    await noOverflow(page);
  });
}

test("resizing works when browser storage is unavailable", async ({ page }) => {
  await fixture(page, "light", undefined, true);
  const before = await width(page);
  await drag(page, 50);
  expect(await width(page)).toBeCloseTo(before + 50, 0);
  await noOverflow(page);
});
