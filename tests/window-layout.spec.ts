import { expect, test, type Page } from "@playwright/test";

async function mockWindow(page: Page, platform: string, seamless = true, failActions = false) {
  await page.addInitScript(({ platform, seamless, failActions }) => {
    Object.defineProperty(window, "__ICEKUBE_WINDOW_LAYOUT__", {
      value: Object.freeze({ platform, seamless }),
    });
    const calls: string[] = [];
    Object.assign(window, {
      __windowCalls: calls,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" } },
        invoke: async (command: string) => {
          calls.push(command);
          if (failActions) throw new Error("Window command rejected");
        },
      },
    });
  }, { platform, seamless, failActions });
}

for (const platform of ["macos", "windows", "linux"]) {
  test(`${platform}: one toolbar row clears native controls at desktop and narrow widths`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockWindow(page, platform);
    await page.goto("/");
    await page.setViewportSize({ width: 1100, height: 700 });
    await expect(page).toHaveURL(/#\/catalog$/);
    const toolbar = page.getByTestId("window-safe-area");
    await expect(toolbar).toBeVisible();
    await expect(page.getByRole("navigation", { name: "App toolbar", exact: true })).toHaveCount(1);
    await expect(toolbar.getByText("Icekube", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close window", exact: true }))
      .toHaveCount(platform === "macos" ? 0 : 1);
    await expect(toolbar.locator("[data-tauri-drag-region]").first()).toBeVisible();
    for (const width of [1100, 800, 360]) {
      await page.setViewportSize({ width, height: 600 });
      await expect(page.getByRole("button", { name: width < 768 ? "Open sidebar" : "Collapse sidebar", exact: true })).toBeVisible();
      await expect(toolbar).toBeVisible();
      const chrome = await toolbar.boundingBox();
      const main = await page.getByRole("main").boundingBox();
      expect(chrome!.height).toBeGreaterThanOrEqual(44);
      expect(chrome!.y).toBe(0);
      expect(chrome!.height).toBeLessThanOrEqual(48);
      for (const name of [width < 768 ? "Open sidebar" : "Collapse sidebar", "Go back", "Go forward", "Preferences", "Search", "Refresh catalog"]) {
        const action = page.getByRole("button", { name, exact: true });
        await expect(action).toBeVisible();
        const bounds = await action.boundingBox();
        expect(bounds!.y).toBeGreaterThanOrEqual(chrome!.y);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(chrome!.y + chrome!.height);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(await action.evaluate((element) => element.closest("[data-tauri-drag-region]") === null)).toBe(true);
      }
      const home = await page.getByRole("button", { name: width < 768 ? "Open sidebar" : "Collapse sidebar", exact: true }).boundingBox();
      if (platform === "macos") {
        expect(home!.x).toBeGreaterThanOrEqual(80);
        const refresh = (await toolbar.getByRole("button", { name: "Refresh catalog", exact: true }).boundingBox())!;
        const clearance = await toolbar.evaluate(element => Number.parseFloat(getComputedStyle(element).paddingRight));
        expect(clearance).toBeGreaterThan(0);
        expect(chrome!.x + chrome!.width - refresh.x - refresh.width).toBeCloseTo(clearance, 1);
      }
      expect(main!.y).toBeGreaterThanOrEqual(chrome!.y + chrome!.height);
      expect(main!.y).toBeLessThanOrEqual(chrome!.y + chrome!.height + 1);
      expect(main!.y + main!.height).toBeLessThanOrEqual(601);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    expect(errors).toEqual([]);
  });

  test(`${platform}: disabling seamless keeps Catalog without native chrome`, async ({ page }) => {
    await mockWindow(page, platform, false);
    await page.goto("/");
    await expect(page.getByTestId("window-safe-area")).toHaveCount(0);
  await expect(page.locator("[data-seamless], [data-tauri-drag-region]")).toHaveCount(0);
  for (const name of ["Minimize window", "Maximize or restore window", "Close window"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  const toolbar = page.getByRole("navigation", { name: "App toolbar", exact: true });
  expect(await toolbar.evaluate(element => getComputedStyle(element).paddingRight)).toBe("0px");
    await expect(page.getByRole("heading", { level: 1, name: "All Categories", exact: true })).toBeAttached();
    await expect(page.getByRole("button", { name: "Close window", exact: true })).toHaveCount(0);
  });
}

test("browser preview opens Catalog and preserves history and search without native APIs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/#\/catalog$/);
  await expect(page.getByRole("heading", { level: 1, name: "All Categories", exact: true })).toBeAttached();
  await expect(page.getByTestId("window-safe-area")).toHaveCount(0);
  await page.getByRole("link", { name: "Clusters", exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog\/clusters$/);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog$/);
  await page.getByRole("button", { name: "Go forward", exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog\/clusters$/);
  await page.getByRole("link", { name: "All Categories", exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog\/all$/);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Welcome Page", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("window controls invoke native commands and do not become drag regions", async ({ page }) => {
  await mockWindow(page, "windows");
  await page.goto("/");
  for (const name of ["Minimize window", "Maximize or restore window", "Close window"]) {
    const control = page.getByRole("button", { name, exact: true });
    await expect(control).not.toHaveAttribute("data-tauri-drag-region");
    expect(await control.evaluate((element) => element.closest("[data-tauri-drag-region]") === null)).toBe(true);
    await control.focus();
    await page.keyboard.press("Enter");
  }
  expect(await page.evaluate(() => (window as unknown as { __windowCalls: string[] }).__windowCalls)).toEqual([
    "plugin:window|minimize", "plugin:window|toggle_maximize", "plugin:window|close",
  ]);
});

test("failed native actions show an accessible error", async ({ page }) => {
  await mockWindow(page, "linux", true, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Minimize window", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Window action failed" })).toBeVisible();
});

test("compact toolbar keeps narrow-window navigation accessible", async ({ page }) => {
  await mockWindow(page, "macos");
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto("/");
  await expect(page).toHaveURL(/#\/catalog$/);
  const toggle = page.getByRole("button", { name: "Open sidebar", exact: true });
  await toggle.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("categories cannot be pinned and there is only one sidebar", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("icekube.pinned-pages.v1", JSON.stringify([
    "/catalog/general", "/catalog/clusters", "/catalog/web-links",
  ])));
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Catalog navigation", exact: true });
  await expect(sidebar).toHaveCount(1);
  await expect(sidebar.getByRole("link")).toHaveCount(3);
  await expect(page.getByRole("navigation", { name: "Apps", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Home", exact: true })).toHaveCount(0);
  for (const category of ["All Categories", "Clusters", "Web Links"]) {
    await page.getByRole("navigation", { name: "Catalog navigation", exact: true }).getByRole("link", { name: category, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: category, exact: true })).toBeAttached();
    await expect(page.getByRole("button", { name: /\b(?:Pin|Unpin)\b/ })).toHaveCount(0);
  }
  await expect(page.getByRole("table", { name: "Web links", exact: true })).toBeVisible();
  await page.reload();
  await expect(sidebar.getByRole("link")).toHaveCount(3);
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("toolbar toggle collapses one sidebar and persists the desktop preference", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Catalog navigation", exact: true });
  await expect(sidebar).toHaveCount(1);
  const expanded = await sidebar.boundingBox();
  const toggle = page.getByRole("button", { name: "Collapse sidebar", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAttribute("aria-controls", "catalog-sidebar");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(expanded!.width);
  await expect(sidebar.getByRole("link", { name: "Clusters", exact: true })).toBeVisible();
  await sidebar.getByRole("link", { name: "Clusters", exact: true }).click();
  await expect(page.getByRole("table", { name: "Clusters", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("sidebar-collapsed.png") });
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(expanded!.width - 1);
  await expect(sidebar.getByText("Categories", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("sidebar-expanded.png") });
});

test("narrow sidebar drawer ignores desktop collapse and closes after navigation", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("icekube.sidebar-collapsed.v1", "true"));
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Open sidebar", exact: true });
  await toggle.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("navigation", { name: "Catalog navigation", exact: true })).toHaveCount(1);
  await expect(drawer.getByRole("link", { name: "Web Links", exact: true })).toBeVisible();
  await drawer.getByRole("link", { name: "Web Links", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("table", { name: "Web links", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
});
