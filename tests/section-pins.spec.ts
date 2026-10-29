import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, options: { fail?: boolean; delay?: number; malformed?: boolean; narrow?: boolean; dark?: boolean } = {}) {
  const calls: { command: string; request?: Record<string, unknown> }[] = [];
  const state = { revision: 1, discoveryError: null, webLinks: [], clusters: [
    { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", status: "disconnected", pinned: true, pinnedSections: [] as string[] },
    { id: "two", name: "Staging", contextName: "stage", source: "kubeconfig", labels: [], color: "#659040", status: "disconnected", pinned: false, pinnedSections: ["pods"] },
  ] };
  page.on("pageerror", error => { throw error; });
  await page.exposeFunction("__pinInvoke", async (command: string, args?: { request: Record<string, unknown> }) => {
    calls.push({ command, request: args?.request });
    const request = args?.request;
    if (command === "catalog_pin_menu_show") return "unpin";
    if (command === "catalog_pin_menu_cancel") return;
    if (command === "catalog_set_pin") {
      const cluster = state.clusters.find(item => item.id === request?.id)!;
      cluster.pinned = !!request?.pinned;
      cluster.pinnedSections = cluster.pinnedSections.filter(section => section !== "overview");
      state.revision++;
      return structuredClone(state);
    }
    if (command === "catalog_set_section_pin") {
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
      if (options.fail) throw "storeUnavailable";
      const cluster = state.clusters.find(item => item.id === request?.clusterId)!;
      cluster.pinnedSections = request?.pinned ? [...cluster.pinnedSections, request.section as string] : cluster.pinnedSections.filter(section => section !== request?.section);
      state.revision++;
      return structuredClone(state);
    }
    if (command === "catalog_list") return options.malformed
      ? { ...structuredClone(state), clusters: [{ ...state.clusters[0], pinnedSections: ["pods", "pods"] }] }
      : structuredClone(state);
    if (command === "catalog_connection_states") return [];
    if (command === "cluster_session_open" || command === "cluster_connect") return { ...request, sessionId: request?.sessionId ?? `session-${request?.clusterId}`, contextName: "fixture", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: "v1.35.8", error: null };
    if (command === "cluster_permissions_review") return { ...request, authorizationEpoch: "fixture", revision: request?.readId, checkedAt: Date.now(), expiresAt: Date.now() + 30_000, items: (request?.checks as unknown[]).map(check => ({ check, decision: "allowed", reason: null })) };
    if (command === "cluster_resources") return { ...request, namespace: request?.namespace ?? null, continueToken: null, metrics: null, items: [], truncated: false, fetchedAt: Date.now() };
    if (["cluster_disconnect", "cluster_resources_cancel", "cluster_permissions_cancel", "cluster_permissions_refresh"].includes(command)) return null;
    throw new Error(`Unexpected IPC: ${command}`);
  });
  await page.addInitScript(() => {
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) =>
      (window as unknown as { __pinInvoke: (command: string, args: unknown) => Promise<unknown> }).__pinInvoke(command, args) } });
  });
  await page.emulateMedia({ colorScheme: options.dark ? "dark" : "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: options.narrow ? 360 : 1200, height: 800 });
  await page.goto("/#/cluster/one?section=overview");
  if (!options.malformed) await expect(page.getByRole("heading", { name: "Cluster overview", exact: true })).toBeVisible();
  return { calls, state };
}
const workspace = (page: Page) => page.getByRole("navigation", { name: "Cluster navigation", exact: true });
const catalog = (page: Page) => page.getByRole("navigation", { name: "Catalog navigation", exact: true });

test("Config children expose the same hover pin action", async ({ page }) => {
  await fixture(page);
  const nav = workspace(page);
  await nav.getByRole("button", { name: "Expand Config", exact: true }).click();
  await page.mouse.move(1100, 700);
  await page.getByRole("heading", { name: "Cluster overview", exact: true }).focus();
  const pin = nav.getByRole("button", { name: "Pin Config Maps for Development", exact: true });
  await expect(pin).toHaveCSS("opacity", "0");
  await nav.getByTestId("cluster-nav-config-maps").hover();
  await expect(pin).toHaveCSS("opacity", "1");
  await pin.click();
  await expect(catalog(page).getByRole("link", { name: "Development · Config Maps", exact: true })).toBeVisible();
});

test("Cluster sidebar and Catalog list share one pin, including saved overview duplicates", async ({ page }) => {
  const { calls, state } = await fixture(page);
  const nav = workspace(page);
  await nav.getByRole("button", { name: "Unpin Cluster for Development", exact: true }).click();
  await expect(catalog(page).getByRole("link", { name: "Development", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "Pin Cluster for Development", exact: true })).toHaveAttribute("aria-pressed", "false");
  await nav.getByTestId("cluster-nav-overview").hover();
  await nav.getByRole("button", { name: "Pin Cluster for Development", exact: true }).click();
  await expect(catalog(page).getByRole("link", { name: "Development", exact: true })).toHaveCount(1);
  await expect(catalog(page).getByRole("link", { name: "Development · Cluster", exact: true })).toHaveCount(0);
  expect(calls.filter(call => call.command === "catalog_set_pin").map(call => call.request)).toEqual([
    { id: "one", pinned: false }, { id: "one", pinned: true },
  ]);
  expect(calls.filter(call => call.command === "catalog_set_section_pin")).toHaveLength(0);
  state.clusters[0].pinned = false;
  state.clusters[0].pinnedSections = ["overview", "pods"];
  await page.reload();
  await expect(catalog(page).getByRole("link", { name: "Development", exact: true })).toHaveCount(1);
  await expect(catalog(page).getByRole("link", { name: "Development · Cluster", exact: true })).toHaveCount(0);
  await expect(catalog(page).getByRole("link", { name: "Development · Pods", exact: true })).toHaveCount(1);
  await expect(nav.getByRole("button", { name: "Unpin Cluster for Development", exact: true })).toHaveAttribute("aria-pressed", "true");
  await nav.getByRole("button", { name: "Unpin Cluster for Development", exact: true }).click();
  await expect(catalog(page).getByRole("link", { name: "Development", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(catalog(page).getByRole("link", { name: "Development", exact: true })).toHaveCount(0);
});

test("section pins remain named and usable with enlarged text and long cluster names", async ({ page }) => {
  const { state } = await fixture(page);
  const name = "Development cluster with a deliberately long display name";
  state.clusters[0].name = name;
  state.clusters[0].pinnedSections = ["pods", "namespaces", "workloads"];
  await page.reload();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const shortcut = catalog(page).getByRole("link", { name: `${name} · Pods`, exact: true });
  await expect(shortcut).toBeVisible();
  await shortcut.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/cluster\/one\?section=pods$/);
  await expect(workspace(page).getByRole("button", { name: `Unpin Pods for ${name}`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1200);
});

for (const dark of [false, true]) test(`section pins preserve cluster identity, destination icons and color (${dark ? "dark" : "light"})`, async ({ page }, testInfo) => {
  const { calls } = await fixture(page, { dark });
  const nav = workspace(page);
  const workloadsPin = nav.getByRole("button", { name: "Pin Workloads for Development", exact: true });
  await expect(workloadsPin).toHaveAttribute("data-pinned", "false");
  await expect(workloadsPin).toHaveCSS("opacity", "0");
  await workloadsPin.locator("xpath=../..").hover();
  await expect(workloadsPin).toHaveCSS("opacity", "1");
  const pinBounds = await workloadsPin.boundingBox();
  const chevronBounds = await nav.getByRole("button", { name: "Expand Workloads", exact: true }).locator("svg").last().boundingBox();
  expect(pinBounds!.x + pinBounds!.width).toBeLessThanOrEqual(chevronBounds!.x);
  await workloadsPin.click();
  await page.mouse.move(1100, 700);
  await page.getByRole("heading", { name: "Cluster overview", exact: true }).focus();
  await expect(nav.getByRole("button", { name: "Unpin Workloads for Development", exact: true })).toHaveCSS("opacity", "1");
  await expect(page).toHaveURL(/section=overview$/);
  await expect(nav.getByRole("button", { name: "Expand Workloads", exact: true })).toHaveAttribute("aria-expanded", "false");
  await nav.getByRole("button", { name: "Expand Workloads", exact: true }).locator("svg").last().click();
  await nav.getByRole("button", { name: "Pin Pods for Development", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("button", { name: "Unpin Pods for Development", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/section=overview$/);
  await nav.getByTestId("cluster-nav-namespaces").hover();
  await nav.getByRole("button", { name: "Pin Namespaces for Development", exact: true }).click();
  const pins = catalog(page);
  for (const [label, icon] of [["Workloads", "packages"], ["Pods", "cube"], ["Namespaces", "sitemap"]]) {
    const link = pins.getByRole("link", { name: `Development · ${label}`, exact: true });
    await expect(link.locator("[data-record-color]")).toHaveAttribute("data-record-color", "#476BA1");
    await expect(link.locator(`svg.tabler-icon-${icon}`)).toHaveCount(1);
    expect(await link.locator("[data-record-color]").evaluate(element => getComputedStyle(element).color))
      .toBe(await pins.getByRole("link", { name: "Development", exact: true }).locator("[data-record-color]").evaluate(element => getComputedStyle(element).color));
  }
  await pins.getByRole("link", { name: "Development · Pods", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/cluster\/one\?section=pods$/);
  await expect(page.getByRole("table", { name: "Pods", exact: true })).toBeVisible();
  await expect(pins.getByRole("link", { name: "Development · Pods", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(pins.getByRole("link", { name: "Development", exact: true })).not.toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(pins.getByRole("link", { name: "Development · Pods", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("section-pins-expanded.png") });
  await testInfo.attach("pin-control-review", { contentType: "application/json", body: JSON.stringify(await nav.getByRole("button", { name: "Unpin Pods for Development", exact: true }).evaluate(element => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, foreground: style.color,
      backgrounds: [element, element.parentElement, element.closest("nav"), document.body, document.documentElement].filter(Boolean).map(node => getComputedStyle(node!).backgroundColor) };
  })) });
  await pins.getByRole("link", { name: "Development · Pods", exact: true }).click({ button: "right" });
  await expect(pins.getByRole("link", { name: "Development · Pods", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/cluster\/one\?section=pods$/);
  await pins.getByRole("link", { name: "Staging · Pods", exact: true }).click();
  await expect(page).toHaveURL(/cluster\/two\?section=pods$/);
  await expect(page.getByRole("table", { name: "Pods", exact: true })).toBeVisible();
  await pins.getByRole("link", { name: "Development · Workloads", exact: true }).click();
  await expect(page).toHaveURL(/cluster\/one\?section=workloads$/);
  await expect(page.getByRole("navigation", { name: "Workloads destinations", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("section-pins.png") });
  expect(calls.filter(call => call.command === "catalog_set_section_pin").map(call => call.request)).toEqual([
    { clusterId: "one", section: "workloads", pinned: true }, { clusterId: "one", section: "pods", pinned: true },
    { clusterId: "one", section: "namespaces", pinned: true }, { clusterId: "one", section: "pods", pinned: false },
  ]);
  await expect(nav.getByRole("button", { name: "Unpin Cluster for Development", exact: true })).toHaveCount(1);
  await expect(pins.getByRole("link", { name: "Development", exact: true })).toHaveCount(1);
});

test("pin saves serialize actions, surface failure, and retain prior shortcuts", async ({ page }) => {
  const { calls } = await fixture(page, { fail: true, delay: 300 });
  const button = workspace(page).getByRole("button", { name: "Pin Namespaces for Development", exact: true });
  await workspace(page).getByTestId("cluster-nav-namespaces").hover();
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("could not be read or saved");
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(catalog(page).getByRole("link", { name: "Development · Namespaces", exact: true })).toHaveCount(0);
  await expect(catalog(page).getByRole("link", { name: "Staging · Pods", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/section=overview$/);
  expect(calls.filter(call => call.command === "catalog_set_section_pin")).toHaveLength(1);
});

test("narrow drawer pin action stays open, shortcut navigation closes it, and no sideways overflow", async ({ page }, testInfo) => {
  await fixture(page, { narrow: true });
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await workspace(page).getByTestId("cluster-nav-namespaces").hover();
  await drawer.getByRole("button", { name: "Pin Namespaces for Development", exact: true }).click();
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/section=overview$/);
  await page.screenshot({ path: testInfo.outputPath("section-pins-narrow.png") });
  await testInfo.attach("narrow-pin-control-size", { contentType: "application/json", body: JSON.stringify(await workspace(page).getByRole("button", { name: "Unpin Namespaces for Development", exact: true }).boundingBox()) });
  await drawer.getByRole("link", { name: "Development · Namespaces", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/section=namespaces$/);
  await expect(page.getByRole("table", { name: "Namespaces", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("invalid persisted section pins fail the catalog contract", async ({ page }) => {
  await fixture(page, { malformed: true });
  await expect(page.getByRole("alert")).toContainText("unsupported response");
  await expect(catalog(page).getByRole("link", { name: /Development ·/ })).toHaveCount(0);
});
