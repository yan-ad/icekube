import { expect, test, type Page } from "@playwright/test";

type Controls = { fail: boolean; hold: boolean; empty: boolean };
type ErrorWindow = Window & { __errors: Controls; __reads: string[]; __finishRead: () => void };
async function fixture(page: Page, section?: string, empty = false) {
  await page.addInitScript(({ empty }) => {
    const target = window as ErrorWindow;
    target.__errors = { fail: !empty, hold: false, empty };
    target.__reads = [];
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
      const r = args?.request ?? {};
      if (command === "preferences_get") return null;
      if (command === "update_state") return { phase: "idle", version: null, error: null };
      if (command === "catalog_connection_states") return [];
      if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: r.clusterId, sessionId: r.sessionId ?? "lease-1", contextName: "fixture", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
      if (command === "catalog_list" || command === "helm_table" || command === "cluster_resources") {
        target.__reads.push(command);
        const controls = { ...target.__errors };
        if (controls.hold) await new Promise<void>(resolve => { target.__finishRead = resolve; });
        const clusterRoute = location.hash.includes("/cluster/");
        if (controls.fail && (command !== "catalog_list" || !clusterRoute)) throw command === "catalog_list" ? "storeCorrupt" : "permissionDenied";
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: controls.empty ? [] : [{ id: "one", name: "Error fixture", contextName: "fixture", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
        if (command === "helm_table") return { ...r, truncated: false, items: [] };
        return { ...r, namespace: null, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null, items: [] };
      }
      if (command.endsWith("_cancel") || command === "cluster_disconnect") return null;
      throw "unsupported";
    } } });
  }, { empty });
  await page.goto(section ? `/#/cluster/one?section=${section}` : "/#/catalog/all");
}
const count = (page: Page, command = "catalog_list") => page.evaluate(command => (window as ErrorWindow).__reads.filter(item => item === command).length, command);
const controls = (page: Page, value: Partial<Controls>) => page.evaluate(value => Object.assign((window as ErrorWindow).__errors, value), value);

for (const section of [undefined, "nodes", "pods", "helm-charts", "helm-releases"]) test(`${section ?? "catalog"}: first failure is centered below filters, not an empty table`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await fixture(page, section);
  const state = page.locator('[data-content-error="blocking"]');
  await expect(state).toBeVisible();
  await expect(state.getByRole("heading", { level: 2 })).toBeVisible();
  await expect(state.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  const input = page.getByRole("textbox").first();
  await expect(input).toBeEnabled();
  const box = (await state.boundingBox())!;
  const heading = (await state.getByRole("heading").boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual((await input.boundingBox())!.y + (await input.boundingBox())!.height);
  expect(Math.abs(heading.x + heading.width / 2 - box.x - box.width / 2)).toBeLessThan(2);
  const body = (await state.locator(":scope > *").boundingBox())!;
  expect(Math.abs(body.y + body.height / 2 - box.y - box.height / 2)).toBeLessThan(2);
  await expect(page.getByRole("table")).toHaveCount(0);
  if (section === "nodes" || section === "pods") await expect(state).toContainText("permissionDenied");
  expect(errors).toEqual([]);
});

for (const colorScheme of ["light", "dark"] as const) test(`blocking error wraps inside a narrow ${colorScheme} viewport`, async ({ page }) => {
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize({ width: 390, height: 740 });
  await fixture(page, "helm-charts");
  const state = page.locator('[data-content-error="blocking"]');
  await expect(state).toBeVisible();
  await expect(state.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const box = (await state.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test("catalog shortcut ignores modified, repeated and composing keys", async ({ page }) => {
  await fixture(page);
  await expect(page.locator('[data-content-error="blocking"]')).toBeVisible();
  const before = await count(page);
  await page.evaluate(() => {
    for (const extra of [{ shiftKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }, { metaKey: true }]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, cancelable: true, ...extra }));
    }
  });
  expect(await count(page)).toBe(before);
});

test("empty catalog remains distinct from failure", async ({ page }) => {
  await fixture(page, undefined, true);
  await expect(page.getByRole("heading", { name: "Your catalog is empty" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const shortcut of ["Control+r", "Meta+r"]) test(`catalog ${shortcut} retries once and blocks duplicate reads while busy`, async ({ page }) => {
  await fixture(page);
  await expect(page.locator('[data-content-error="blocking"]')).toBeVisible();
  const before = await count(page);
  await controls(page, { hold: true });
  await page.keyboard.press(shortcut);
  await expect.poll(() => count(page)).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Refresh catalog", exact: true })).toBeDisabled();
  await page.keyboard.press(shortcut);
  await expect(page.getByRole("textbox", { name: "Filter catalog" })).toBeEnabled();
  expect(await count(page)).toBe(before + 1);
  await page.evaluate(() => (window as ErrorWindow).__finishRead());
  await expect(page.locator('[data-content-error="blocking"]')).toBeVisible();
});

test("retained rows keep a compact stale banner and a callable retry", async ({ page }) => {
  await fixture(page);
  await expect(page.locator('[data-content-error="blocking"]')).toBeVisible();
  await controls(page, { fail: false });
  await page.getByRole("alert").getByRole("button", { name: "Refresh", exact: true }).click();
  const row = page.getByRole("cell", { name: "Error fixture", exact: true });
  await expect(row).toBeVisible();
  await controls(page, { fail: true });
  await page.keyboard.press("Control+r");
  const banner = page.locator('[data-content-error="retained"]');
  await expect(banner).toContainText("may be stale");
  await expect(row).toBeVisible();
  await expect(page.locator('[data-content-error="blocking"]')).toHaveCount(0);
  const before = await count(page);
  await controls(page, { hold: true });
  await banner.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => count(page)).toBe(before + 1);
  await page.keyboard.press("Meta+r");
  expect(await count(page)).toBe(before + 1);
});

test("browser preview error offers no nonfunctional retry or shortcut hint", async ({ page }) => {
  await page.goto("/#/catalog/all");
  const state = page.locator('[data-content-error="blocking"]');
  await expect(state).toBeVisible();
  await expect(state.getByRole("button")).toHaveCount(0);
  await expect(state).not.toContainText("Cmd/Ctrl+R");
});
