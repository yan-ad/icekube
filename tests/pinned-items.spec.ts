import { expect, test, type Page } from "@playwright/test";

type Target = { id: string; section: string | null };
async function fixture(page: Page, options: { failSave?: boolean; pendingMenu?: boolean; invalidOrder?: boolean; narrow?: boolean } = {}) {
  const initial: Target[] = [{ id: "one", section: null }, { id: "two", section: null }, { id: "one", section: "pods" }, { id: "two", section: "namespaces" }];
  const state = { revision: 1, discoveryError: null,
    clusters: [
      { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", status: "disconnected", pinned: true, pinnedSections: ["pods"] },
      { id: "two", name: "Staging", contextName: "stage", source: "kubeconfig", labels: [], color: "#659040", status: "disconnected", pinned: true, pinnedSections: ["namespaces"] },
    ],
    pinnedItems: initial,
  };
  const calls: { command: string; request?: Record<string, unknown> }[] = [];
  let menuAction: unknown = "unpin";
  let reply: ((value: unknown) => void) | null = null;
  page.on("pageerror", error => { throw error; });
  await page.exposeFunction("__pinTestInvoke", async (command: string, args?: { request: Record<string, unknown> }) => {
    const request = args?.request;
    calls.push({ command, request });
    if (command === "catalog_list") return options.invalidOrder ? { ...state, pinnedItems: [initial[0], initial[0], initial[2], initial[3]] } : structuredClone(state);
    if (command === "catalog_connection_states") return [];
    if (command === "catalog_pin_menu_show") return options.pendingMenu ? new Promise(resolve => { reply = resolve; }) : menuAction;
    if (command === "catalog_pin_menu_cancel") { reply?.("unpin"); reply = null; return; }
    if (command === "catalog_reorder_pins") {
      if (options.failSave) throw "storeUnavailable";
      state.pinnedItems = structuredClone(request?.items as Target[]);
      state.revision++;
      return structuredClone(state);
    }
    if (command === "catalog_set_pin" || command === "catalog_set_section_pin") {
      const id = (request?.id ?? request?.clusterId) as string;
      const section = request?.section ?? null;
      if (section) state.clusters.find(item => item.id === id)!.pinnedSections = [];
      else state.clusters.find(item => item.id === id)!.pinned = false;
      state.pinnedItems = state.pinnedItems.filter(item => item.id !== id || item.section !== section);
      state.revision++;
      return structuredClone(state);
    }
    throw new Error(`Unexpected command ${command}`);
  });
  await page.addInitScript(() => {
    localStorage.setItem("iceon.sidebar-collapsed.v1", "false");
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) =>
      (window as unknown as { __pinTestInvoke: (command: string, args?: unknown) => Promise<unknown> }).__pinTestInvoke(command, args) } });
  });
  await page.setViewportSize({ width: options.narrow ? 360 : 1200, height: 800 });
  await page.goto("/#/catalog/clusters");
  return { state, calls, setMenuAction: (action: unknown) => { menuAction = action; }, reply: () => reply?.("unpin") };
}
const rail = (page: Page) => page.getByRole("navigation", { name: "Catalog navigation", exact: true });
const pinLabels = (page: Page) => rail(page).locator("[data-pin-key]").evaluateAll(items => items.map(item => item.getAttribute("aria-label")));
const names = ["Development", "Staging", "Development · Pods", "Staging · Namespaces"];

test("sidebar stays icon-only through preferences, reload and narrow widths without toolbar toggle", async ({ page }, testInfo) => {
  await fixture(page);
  await expect(rail(page)).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByRole("button", { name: /^(Expand|Collapse) sidebar$/ })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "App toolbar", exact: true }).getByRole("button", { name: "Open sidebar" })).toHaveCount(0);
  await expect.poll(() => pinLabels(page)).toEqual(names);
  await page.reload();
  await expect(rail(page)).toHaveAttribute("data-collapsed", "true");
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(rail(page).getByRole("button", { name: "Open sidebar", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("narrow-pinned-rail.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

for (const name of ["Development", "Staging", "Development · Pods", "Staging · Namespaces"]) test(`native right-click Unpin targets ${name} without activation`, async ({ page }) => {
  const { calls } = await fixture(page);
  const pin = rail(page).getByRole("link", { name, exact: true });
  await pin.click({ button: "right" });
  await expect(pin).toHaveCount(0);
  await expect(page).toHaveURL(/catalog\/clusters$/);
  const menus = calls.filter(call => call.command === "catalog_pin_menu_show");
  expect(menus).toHaveLength(1);
  expect(menus[0].request?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(calls.filter(call => call.command === "cluster_session_open")).toHaveLength(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("drag mixes cluster and section pins, persists order and never activates routes", async ({ page }) => {
  const { calls } = await fixture(page);
  await rail(page).getByRole("link", { name: "Staging · Namespaces", exact: true }).dragTo(rail(page).getByRole("link", { name: "Development", exact: true }));
  await expect.poll(() => pinLabels(page)).toEqual([names[3], names[0], names[1], names[2]]);
  await expect(page).toHaveURL(/catalog\/clusters$/);
  await page.reload();
  await expect.poll(() => pinLabels(page)).toEqual([names[3], names[0], names[1], names[2]]);
  const saved = calls.filter(call => call.command === "catalog_reorder_pins");
  expect(saved).toHaveLength(1);
  expect(saved[0].request?.items).toEqual([
    { id: "two", section: "namespaces" }, { id: "one", section: null }, { id: "two", section: null }, { id: "one", section: "pods" },
  ]);
  expect(calls.filter(call => call.command === "cluster_session_open")).toHaveLength(0);
});

test("keyboard menu moves and keyboard reorder retain focus and scope", async ({ page }) => {
  const { calls, setMenuAction } = await fixture(page);
  setMenuAction("moveUp");
  const pods = rail(page).getByRole("link", { name: names[2], exact: true });
  await pods.focus();
  await page.keyboard.press("Shift+F10");
  await expect.poll(() => pinLabels(page)).toEqual([names[0], names[2], names[1], names[3]]);
  await expect(pods).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => pinLabels(page)).toEqual([names[2], names[0], names[1], names[3]]);
  await expect(pods).toBeFocused();
  await expect(page).toHaveURL(/catalog\/clusters$/);
  expect(calls.filter(call => call.command === "catalog_reorder_pins")).toHaveLength(2);
});

test("failed reorder keeps saved order and exposes retryable error", async ({ page }) => {
  await fixture(page, { failSave: true });
  await rail(page).getByRole("link", { name: names[3], exact: true }).dragTo(rail(page).getByRole("link", { name: names[0], exact: true }));
  await expect(page.getByRole("alert")).toContainText("could not be read or saved");
  await expect.poll(() => pinLabels(page)).toEqual(names);
});

test("dismissed native menus and malformed replies never mutate pins", async ({ page }) => {
  const { calls, setMenuAction } = await fixture(page);
  const pin = rail(page).getByRole("link", { name: names[0], exact: true });
  setMenuAction(null);
  await pin.click({ button: "right" });
  await expect.poll(() => calls.filter(call => call.command === "catalog_pin_menu_show").length).toBe(1);
  await expect.poll(() => pinLabels(page)).toEqual(names);
  setMenuAction({ action: "unpin" });
  await pin.click({ button: "right" });
  await expect(page.getByRole("alert")).toContainText("unsupported response");
  expect(calls.filter(call => call.command === "catalog_set_pin" || call.command === "catalog_reorder_pins")).toHaveLength(0);
  await expect.poll(() => pinLabels(page)).toEqual(names);
});

test("late native selection after navigation is canceled and ignored", async ({ page }) => {
  const { calls } = await fixture(page, { pendingMenu: true });
  await rail(page).getByRole("link", { name: names[0], exact: true }).click({ button: "right" });
  await expect.poll(() => calls.filter(call => call.command === "catalog_pin_menu_show").length).toBe(1);
  await page.evaluate(() => { location.hash = "/catalog"; });
  await expect.poll(() => calls.filter(call => call.command === "catalog_pin_menu_cancel").length).toBe(1);
  expect(calls.filter(call => call.command === "catalog_set_pin")).toHaveLength(0);
  await expect(rail(page).getByRole("link", { name: names[0], exact: true })).toBeVisible();
});

test("duplicate authoritative order is rejected", async ({ page }) => {
  await fixture(page, { invalidOrder: true });
  await expect(page.getByRole("alert")).toContainText("unsupported response");
  await expect(rail(page).locator("[data-pin-key]")).toHaveCount(0);
});

test("external drops and self drops cannot save an order", async ({ page }) => {
  const { calls } = await fixture(page);
  const pin = rail(page).getByRole("link", { name: names[0], exact: true });
  await expect(pin).toBeVisible();
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await pin.dispatchEvent("dragover", { dataTransfer });
  await pin.dispatchEvent("drop", { dataTransfer });
  await pin.dispatchEvent("dragstart", { dataTransfer });
  await pin.dispatchEvent("dragover", { dataTransfer });
  await expect(pin).toHaveCSS("outline-style", "solid");
  await expect(pin).toHaveCSS("outline-width", "2px");
  await pin.dispatchEvent("drop", { dataTransfer });
  expect(calls.filter(call => call.command === "catalog_reorder_pins")).toHaveLength(0);
  await expect.poll(() => pinLabels(page)).toEqual(names);
});
