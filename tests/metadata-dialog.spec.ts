import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(() => {
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
      if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: ["one", "two"].map(id => ({ id, name: `Development ${id}`, contextName: `${id}-context`, source: "kubeconfig", labels: ["file=/fixtures/config"], color: "#476BA1", status: "disconnected", pinned: true })) };
      if (command === "cluster_permissions_review") {
        const review = args?.request as unknown as { clusterId: string; sessionId: string; readId: number; checks: unknown[] };
        const checkedAt = Date.now();
        return { clusterId: review.clusterId, sessionId: review.sessionId, readId: review.readId,
          authorizationEpoch: `fixture-${review.sessionId}`, revision: review.readId, checkedAt, expiresAt: checkedAt + 30_000,
          items: review.checks.map(check => ({ check, decision: "allowed", reason: null })) };
      }
      if (command === "cluster_permissions_cancel" || command === "cluster_permissions_refresh") return null;
      if (command === "cluster_session_open" || command === "cluster_connect") return { ...args?.request, sessionId: "fixture-session", contextName: "one-context", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
      if (command === "cluster_resources" && ["nodes", "events"].includes(String(args?.request.kind))) return { ...args?.request, namespace: null, continueToken: null, metrics: null, items: [], truncated: false, fetchedAt: 1793000000000 };
      if (command === "cluster_disconnect" || command === "cluster_resources_cancel") return;
      throw new Error(`Unexpected IPC: ${command}`);
    } } });
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/#/cluster/one");
  await expect(page.getByRole("button", { name: "Cluster actions", exact: true })).toBeVisible();
});

test("saved metadata is a named modal with labeled saved fields, Escape and focus return", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Cluster actions", exact: true });
  await trigger.click();
  await page.getByRole("menuitem", { name: "Show saved metadata", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Saved metadata", exact: true });
  await expect(dialog).toBeVisible();
  for (const label of ["Cluster", "Context", "Source", "Labels"]) await expect(dialog.locator("dt").filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
  for (const value of ["Development one", "one-context", "kubeconfig", "file=/fixtures/config"]) await expect(dialog.getByText(value, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Saved metadata", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("menuitem", { name: "Show saved metadata", exact: true }).click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("metadata modal fits a narrow viewport and does not follow another cluster", async ({ page }) => {
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Show saved metadata", exact: true }).click();
  await page.setViewportSize({ width: 360, height: 700 });
  const dialog = page.getByRole("dialog", { name: "Saved metadata", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(360);
  await page.goto("/#/cluster/two");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Development two");
});
