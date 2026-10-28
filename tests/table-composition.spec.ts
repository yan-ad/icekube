import { expect, test, type Page } from "@playwright/test";
import { resourceViews } from "../src/app/cluster/resourceViews";

const resources = [{ section: "nodes", kind: "nodes", label: "Nodes", namespaced: false },
  ...resourceViews.filter(view => view.kind).map(view => ({ section: view.section, kind: view.kind!, label: view.label, namespaced: view.namespaced }))];

async function fixture(page: Page, section: string) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(({ resources }) => {
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
        const request = args?.request ?? {};
        if (command === "cluster_permissions_cancel") return null;
        if (command === "cluster_permissions_review") {
          const review = request as import("../src/app/cluster/permissionsApi").PermissionReviewRequest;
          return { clusterId: review.clusterId, sessionId: review.sessionId, readId: review.readId, authorizationEpoch: `fixture-epoch-${review.sessionId}`, revision: review.readId, checkedAt: Date.now(), expiresAt: Date.now() + 30000, items: review.checks.map(check => ({ check, decision: "allowed", reason: null })) };
        }
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "preferences_get") return null;
        if (command === "update_state") return { phase: "idle", version: null, error: null };
        if (command === "cluster_session_open" || command === "cluster_connect") return {
          clusterId: request.clusterId, sessionId: request.sessionId ?? "lease-composition", contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null,
        };
        if (command === "cluster_resources_cancel" || command === "cluster_disconnect") return null;
        if (command !== "cluster_resources") throw new Error(`Unexpected fixture command: ${command}`);
        const view = resources.find(view => view.kind === request.kind)!;
        return { ...request, namespace: request.namespace ?? null, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null,
          items: ["alpha", "beta"].filter(name => !request.query || name.includes(String(request.query))).map((name, index) => ({
            name, namespace: view.namespaced ? "team-a" : null, uid: `${name}-uid`, resourceVersion: String(index + 1),
            status: "Running", createdAt: null, node: null, columns: { health: index ? "warning" : "healthy", warning: "NotReady" },
          })),
        };
      },
    } });
  }, { resources });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/cluster/one?section=${section}`);
}

for (const view of resources) test(`${view.label}: selection replaces only heading labels without moving columns`, async ({ page }, testInfo) => {
  await fixture(page, view.section);
  const table = page.getByRole("table", { name: view.label, exact: true });
  const first = table.locator("thead th").nth(1);
  await expect(first).toHaveText("Name");
  const bounds = () => table.locator("thead th").evaluateAll(cells => cells.map(cell => {
    const box = cell.getBoundingClientRect(); return { x: box.x, width: box.width };
  }));
  const before = await bounds();
  const row = table.getByRole("checkbox", { name: `Select ${view.namespaced ? "team-a/" : ""}alpha`, exact: true });
  await row.focus();
  await page.keyboard.press("Space");
  await expect(first.getByRole("status").filter({ hasText: /^1 selected$/ })).toBeVisible();
  await expect(first.getByRole("button", { name: "Clear selection", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: `${view.label} filters`, exact: true }).getByText("1 selected")).toHaveCount(0);
  await expect(table.locator("tbody").getByRole("button", { name: "alpha", exact: true })).toBeVisible();
  await expect(table.getByRole("checkbox", { name: "Select all rows", exact: true })).toBeVisible();
  const secondary = table.locator("thead .table-selection-muted-label");
  expect(await secondary.count()).toBeGreaterThan(0);
  for (const label of await secondary.all()) await expect(label).toHaveCSS("opacity", "0");
  const after = await bounds();
  before.forEach((box, index) => {
    expect(Math.abs(box.x - after[index].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - after[index].width)).toBeLessThanOrEqual(1);
  });
  const alignment = await table.evaluate(el => {
    const header = el.querySelectorAll("thead th")[1];
    const cell = el.querySelectorAll("tbody tr:first-child td")[1];
    const button = cell.querySelector("button")!;
    return { expected: header.getBoundingClientRect().left + parseFloat(getComputedStyle(header).paddingLeft),
      actual: button.getBoundingClientRect().left + parseFloat(getComputedStyle(button).paddingLeft) };
  });
  expect(Math.abs(alignment.expected - alignment.actual)).toBeLessThanOrEqual(1);
  if (["nodes", "pods", "configMaps"].includes(view.kind)) await testInfo.attach(`${view.kind}-selection`, { body: await page.screenshot(), contentType: "image/png" });
  await first.getByRole("button", { name: "Clear selection", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveText("Name");
  await expect(row).not.toBeChecked();
  await expect(secondary).toHaveCount(0);
});

test("filter scope clears selection and restores header labels", async ({ page }) => {
  await fixture(page, "config-maps");
  const table = page.getByRole("table", { name: "Config Maps", exact: true });
  await table.getByRole("checkbox", { name: "Select team-a/alpha", exact: true }).check();
  await expect(table.getByRole("status").filter({ hasText: /^1 selected$/ })).toBeVisible();
  await page.getByRole("textbox", { name: "Search Config Maps", exact: true }).fill("beta");
  await expect(table.locator("thead th").nth(1)).toHaveText("Name");
  await expect(table.getByRole("checkbox", { name: "Select team-a/beta", exact: true })).not.toBeChecked();
});

test("Pod health uses semantic success and warning colors", async ({ page }) => {
  await fixture(page, "pods");
  const healthy = page.getByRole("img", { name: "Ready: all required containers and readiness gates are ready", exact: true }).locator("svg");
  const warning = page.getByRole("img", { name: "Pod needs attention: Not Ready", exact: true }).locator("svg");
  await expect(healthy).toBeVisible();
  await expect(warning).toBeVisible();
  const colors = await healthy.evaluate(el => ({ actual: getComputedStyle(el).color, token: getComputedStyle(el).getPropertyValue("--color-success").trim() }));
  expect(colors.token).not.toBe("");
  expect(await warning.evaluate(el => getComputedStyle(el).color)).not.toBe(colors.actual);
});
