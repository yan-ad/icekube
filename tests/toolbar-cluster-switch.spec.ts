import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, route = "/#/cluster/one?section=network") {
  await page.addInitScript(() => {
    const calls: { command: string; request: Record<string, unknown> }[] = [];
    const control = { holdConnect: false };
    const pending: (() => void)[] = [];
    Object.assign(window, { toolbarCalls: calls, toolbarControl: control,
      releaseToolbarConnect: () => { control.holdConnect = false; pending.splice(0).forEach(resolve => resolve()); },
      isTauri: true, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
        const request = args?.request ?? {};
        calls.push({ command, request });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Primary cluster with a deliberately long saved name", contextName: "one", source: "kubeconfig", status: "disconnected", pinned: false, labels: [], color: "#476BA1" },
          { id: "two", name: "Secondary cluster", contextName: "two", source: "kubeconfig", status: "disconnected", pinned: false, labels: [], color: "#567BA1" },
        ] };
        const snapshot = { clusterId: request.clusterId, sessionId: request.sessionId ?? `lease-${calls.length}`, contextName: request.clusterId, status: "disconnected", apiVersion: null, error: null };
        if (command === "cluster_permissions_review") {
          const review = args?.request as unknown as { clusterId: string; sessionId: string; readId: number; checks: unknown[] };
          const checkedAt = Date.now();
          return { clusterId: review.clusterId, sessionId: review.sessionId, readId: review.readId,
            authorizationEpoch: `fixture-${review.sessionId}`, revision: review.readId, checkedAt, expiresAt: checkedAt + 30_000,
            items: review.checks.map(check => ({ check, decision: "allowed", reason: null })) };
        }
        if (command === "cluster_permissions_cancel" || command === "cluster_permissions_refresh") return null;
        if (command === "cluster_session_open") return snapshot;
        if (command === "cluster_connect") {
          if (control.holdConnect) await new Promise<void>(resolve => pending.push(resolve));
          return { ...snapshot, status: "connected", apiVersion: "v1" };
        }
        if (command === "catalog_connection_states") return [];
        if (command === "cluster_disconnect" || command === "cluster_resources_cancel") return;
        throw new Error(`Unexpected toolbar command: ${command}`);
      },
    } });
  });
  await page.goto(route);
}

async function calls(page: Page) {
  return page.evaluate(() => (window as unknown as { toolbarCalls: { command: string; request: Record<string, unknown> }[] }).toolbarCalls);
}

test("refresh follows forward; searchable cluster switch preserves section and session ownership", async ({ page }) => {
  await fixture(page);
  const toolbar = page.getByRole("navigation", { name: "App toolbar", exact: true });
  const refresh = toolbar.getByRole("button", { name: "Refresh cluster", exact: true });
  await expect(refresh).toBeEnabled();
  const names = await toolbar.locator("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
  expect(names.indexOf("Refresh cluster")).toBe(names.indexOf("Go forward") + 1);
  expect(names.indexOf("Switch cluster")).toBe(names.indexOf("Refresh cluster") + 1);
  await toolbar.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Cluster disconnected", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as Window & { toolbarControl: { holdConnect: boolean } }).toolbarControl.holdConnect = true; });
  await toolbar.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Connect to cluster", exact: true }).click();
  await expect(refresh).toBeDisabled();
  await page.evaluate(() => (window as Window & { releaseToolbarConnect: () => void }).releaseToolbarConnect());
  await expect(refresh).toBeEnabled();
  const before = await calls(page);
  expect(before.filter(call => call.command === "cluster_session_open").length).toBeGreaterThan(1);
  const switcher = toolbar.getByRole("button", { name: "Switch cluster", exact: true });
  await switcher.hover();
  await expect(page.getByRole("tooltip", { name: "Switch cluster · Primary cluster with a deliberately long saved name", exact: true })).toBeVisible();
  await switcher.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Find cluster" }).fill("not saved");
  await expect(page.getByRole("menuitem", { name: "No matching clusters", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Find cluster" }).fill("Secondary");
  await page.getByRole("menuitem", { name: "Secondary cluster", exact: true }).click();
  await expect(page).toHaveURL(/cluster\/two\?section=network/);
  await expect(toolbar.getByRole("button", { name: "Cluster actions", exact: true })).toHaveAttribute("aria-description", "Connection status: Connected");
  const after = await calls(page);
  expect(after.some(call => call.command === "cluster_disconnect" && call.request.clusterId === "one")).toBe(true);
  const opening = after.findIndex(call => call.command === "cluster_session_open" && call.request.clusterId === "two");
  const connecting = after.findIndex(call => call.command === "cluster_connect" && call.request.clusterId === "two");
  expect(opening).toBeGreaterThan(0);
  expect(connecting).toBeGreaterThan(opening);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page).toHaveURL(/cluster\/one\?section=network/);
});

test("catalog refresh stays immediately after forward", async ({ page }) => {
  await fixture(page, "/#/catalog");
  const toolbar = page.getByRole("navigation", { name: "App toolbar", exact: true });
  const refresh = toolbar.getByRole("button", { name: "Refresh catalog", exact: true });
  await expect(refresh).toBeEnabled();
  const names = await toolbar.locator("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
  expect(names.indexOf("Refresh catalog")).toBe(names.indexOf("Go forward") + 1);
  const before = (await calls(page)).filter(call => call.command === "catalog_list").length;
  await refresh.click();
  await expect.poll(async () => (await calls(page)).filter(call => call.command === "catalog_list").length).toBe(before + 1);
});

test("compact toolbar keeps search and preferences available from overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await fixture(page);
  await expect(page.getByRole("button", { name: "Refresh cluster", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Cluster actions", exact: true });
  await expect(menu.getByRole("menuitem", { name: /^Refresh / })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Preferences", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Preferences", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await menu.getByRole("menuitem", { name: "Search", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
