import { expect, test, type Page } from "@playwright/test";

type Controls = { holdPermissions: boolean; holdNamespaces: boolean; holdResources: boolean; unknown: boolean; fail: boolean; release: () => void; calls: { command: string; request: any }[] };
async function fixture(page: Page, theme: "light" | "dark", unknown = false) {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(unknown => {
    const waiters: (() => void)[] = [];
    const control: Controls = { holdPermissions: true, holdNamespaces: true, holdResources: true, unknown, fail: false, calls: [], release: () => waiters.splice(0).forEach(resolve => resolve()) };
    Object.assign(window, { isTauri: true, __toolbar: control, __TAURI_INTERNALS__: {
      invoke: async (command: string, args: any) => {
        const request = args?.request;
        control.calls.push({ command, request });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: "one", sessionId: "toolbar-session", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        if (command === "cluster_permissions_review") {
          if (control.holdPermissions) await new Promise<void>(resolve => waiters.push(resolve));
          return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, authorizationEpoch: "toolbar-epoch", revision: request.readId, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
            items: request.checks.map((check: any) => ({ check, decision: control.unknown ? "unknown" : "allowed", reason: control.unknown ? "reviewUnavailable" : null })) };
        }
        if (command === "cluster_resources") {
          if (request.kind === "namespaces" ? control.holdNamespaces : control.holdResources) await new Promise<void>(resolve => waiters.push(resolve));
          if (control.fail && request.kind !== "namespaces") throw "resourceUnavailable";
          return { ...request, namespace: request.namespace ?? null, continueToken: null, metrics: null, truncated: false, fetchedAt: Date.now(), items: request.kind === "namespaces" ? ["team-a", "team-b"].map(name => ({ name, namespace: null, createdAt: null, status: "Active", columns: {}, node: null })) : [] };
        }
        return null;
      },
    } });
  }, unknown);
  await page.goto("/#/cluster/one?section=vertical-pod-autoscalers");
}
const filters = (page: Page) => page.getByRole("region", { name: "Vertical Pod Autoscalers filters", exact: true });
const search = (page: Page) => page.getByRole("textbox", { name: "Search Vertical Pod Autoscalers", exact: true });
const change = (page: Page, next: Partial<Controls>) => page.evaluate(next => {
  const control = (window as any).__toolbar as Controls;
  Object.assign(control, next); control.release();
}, next);

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: permission and resource loading stay centered with a compact right-aligned search`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1568, height: 900 });
    await fixture(page, theme);
    const checking = page.getByRole("status", { name: "Checking access…", exact: true });
    await expect(checking).toBeVisible();
    await expect(page.getByText("Checking access…", { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(filters(page).locator(".astryx-spinner")).toHaveCount(1);
    const box = (await search(page).boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(300);
    const region = (await filters(page).boundingBox())!;
    expect(box.x).toBeGreaterThan(region.x + region.width / 2);
    await change(page, { holdPermissions: false });
    const loading = page.getByRole("status", { name: "Loading vertical pod autoscalers…", exact: true });
    await expect(loading).toBeVisible();
    await expect(page.getByText("Loading vertical pod autoscalers…", { exact: true }).filter({ visible: true })).toHaveCount(1);
    const surface = page.locator(".content-loading-initial");
    const frame = (await surface.boundingBox())!;
    const ring = (await loading.boundingBox())!;
    expect(Math.abs(ring.x + ring.width / 2 - frame.x - frame.width / 2)).toBeLessThan(2);
    expect(Math.abs(ring.y + ring.height / 2 - frame.y - frame.height / 2)).toBeLessThan(50);
    await page.screenshot({ path: testInfo.outputPath(`${theme}-loading.png`) });
    await change(page, { holdNamespaces: false, holdResources: false });
    await expect(page.getByRole("table", { name: "Vertical Pod Autoscalers", exact: true })).toContainText("No vertical pod autoscalers were returned.");
    await expect(loading).toHaveCount(0);
    await expect(filters(page).locator(".astryx-spinner")).toHaveCount(0);
    expect((await search(page).boundingBox())!.y).toBe(box.y);
    expect(errors).toEqual([]);
  });

  test(`${theme}: a failed resource load stops progress and retries without moving search`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1568, height: 900 });
    await fixture(page, theme);
    await expect(search(page)).toBeVisible();
    const before = (await search(page).boundingBox())!;
    await change(page, { holdPermissions: false, holdNamespaces: false, holdResources: false, fail: true });
    const failure = page.getByRole("alert", { name: "Could not load vertical pod autoscalers", exact: true });
    await expect(failure).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading vertical pod autoscalers…", exact: true })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Vertical Pod Autoscalers", exact: true })).toHaveCount(0);
    await expect(search(page)).toBeEnabled();
    expect((await search(page).boundingBox())!.y).toBe(before.y);
    await change(page, { fail: false });
    await failure.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("table", { name: "Vertical Pod Autoscalers", exact: true })).toContainText("No vertical pod autoscalers were returned.");
    await expect(failure).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`${theme}: namespace fallback stays below compact filters across viewport sizes`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1568, height: 900 });
    await fixture(page, theme, true);
    await change(page, { holdPermissions: false, holdNamespaces: false, holdResources: false });
    await expect(page.getByRole("textbox", { name: "Known namespace", exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "Vertical Pod Autoscalers", exact: true })).toBeVisible();
    await expect(page.getByText("Access unverified", { exact: true })).toBeVisible();
    const title = filters(page).getByText("Vertical Pod Autoscalers", { exact: true });
    for (const width of [1568, 900, 640, 360]) {
      await page.setViewportSize({ width, height: 900 });
      const input = search(page), namespace = page.getByRole("textbox", { name: "Known namespace", exact: true });
      await expect(input).toBeVisible();
      await expect(input).toBeInViewport();
      await input.focus(); await expect(input).toBeFocused();
      const heading = (await title.boundingBox())!, field = (await input.boundingBox())!, manual = (await namespace.boundingBox())!;
      expect(field.width).toBeLessThanOrEqual(300);
      expect(manual.y).toBeGreaterThanOrEqual(Math.max(heading.y + heading.height, field.y + field.height));
      if (width === 1568) expect(Math.abs(heading.y + heading.height / 2 - field.y - field.height / 2)).toBeLessThan(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: testInfo.outputPath(`${theme}-narrow-fallback.png`) });
    await page.getByRole("textbox", { name: "Known namespace", exact: true }).fill("team-a");
    await page.getByRole("textbox", { name: "Known namespace", exact: true }).press("Enter");
    await expect.poll(() => page.evaluate(() => ((window as any).__toolbar as Controls).calls.filter(call => call.command === "cluster_resources" && call.request.kind === "verticalPodAutoscalers").at(-1)?.request.namespace)).toBe("team-a");
    await page.getByRole("button", { name: "Load namespaces", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Namespace(?:\s|$)/ })).toContainText("team-a");
    expect(errors).toEqual([]);
  });
}
