import { expect, test, type Page } from "@playwright/test";
import { clusterSections } from "../src/app/cluster/navigation";

async function fixture(page: Page, section = "overview", narrow = false) {
  page.on("pageerror", (error) => { throw error; });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, { isTauri: true, __navigationCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: { clusterId: string } }) => {
        calls.push(command);
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev-context", source: "kubeconfig", labels: ["file=/fixtures/config"], color: "#476BA1", status: "disconnected", pinned: false },
        ] };
        if (command === "cluster_session_open") return { clusterId: args?.request.clusterId, sessionId: crypto.randomUUID(), contextName: "dev-context", status: "disconnected", apiVersion: null, error: null };
        if (command === "cluster_disconnect") return;
        throw new Error(`Unexpected IPC: ${command}`);
      },
    } });
  });
  await page.setViewportSize({ width: narrow ? 360 : 1200, height: 800 });
  await page.goto(`/#/cluster/one?section=${section}`);
  await expect(page.getByRole("button", { name: "Connect to cluster", exact: true })).toBeEnabled();
}
const navigation = (page: Page) => page.getByRole("navigation", { name: "Cluster navigation", exact: true });
async function noImplicitRequests(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __navigationCalls: string[] }).__navigationCalls);
  expect(calls.every((command) => ["catalog_list", "cluster_session_open", "cluster_disconnect"].includes(command))).toBe(true);
}

test("disclosures expand and collapse by keyboard without navigation; children have real destinations", async ({ page }) => {
  await fixture(page);
  const nav = navigation(page);
  const toggle = nav.getByRole("button", { name: "Expand Workloads", exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("button", { name: "Collapse Workloads", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(/section=overview$/);
  await expect(nav.getByRole("link", { name: "Pods", exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "Pods", exact: true })).toHaveCount(0);
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("link", { name: "Overview", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/section=pods$/);
  await expect(nav.getByRole("link", { name: "Pods", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("main")).toContainText("not implemented yet");
  await noImplicitRequests(page);
});

test("leaf direct links survive reload and back/forward reopens a collapsed ancestor", async ({ page }) => {
  await fixture(page, "deployments");
  const nav = navigation(page);
  await expect(nav.getByRole("button", { name: "Collapse Workloads", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "Deployments", exact: true })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(nav.getByRole("link", { name: "Deployments", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "Collapse Workloads", exact: true }).click();
  await nav.getByRole("link", { name: "Nodes", exact: true }).click();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(nav.getByRole("link", { name: "Deployments", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Go forward", exact: true }).click();
  await expect(nav.getByRole("link", { name: "Nodes", exact: true })).toHaveAttribute("aria-current", "page");
  await noImplicitRequests(page);
});

test("every reference group exposes its children and unsupported leaves stay honest without resource IPC", async ({ page }) => {
  await fixture(page);
  const nav = navigation(page);
  for (const group of clusterSections) {
    if (!("children" in group)) continue;
    await nav.getByRole("button", { name: `Expand ${group.label}`, exact: true }).click();
    for (const child of group.children) {
      await nav.getByRole("link", { name: child.label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`section=${child.id}$`));
      await expect(page.getByRole("heading", { level: 2, name: child.label, exact: true })).toBeVisible();
      await expect(page.getByRole("main")).toContainText("not implemented yet");
      await expect(nav.getByRole("link", { name: child.label, exact: true })).toHaveAttribute("aria-current", "page");
    }
    await nav.getByRole("button", { name: `Collapse ${group.label}`, exact: true }).click();
  }
  await noImplicitRequests(page);
});

test("narrow drawer keeps disclosures open but closes on leaf activation", async ({ page }) => {
  await fixture(page, "overview", true);
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const nav = dialog.getByRole("navigation", { name: "Cluster navigation", exact: true });
  await nav.getByRole("button", { name: "Expand Helm", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/section=overview$/);
  await nav.getByRole("link", { name: "Charts", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/section=helm-charts$/);
  await expect(page.getByRole("main")).toContainText("not implemented yet");
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(nav.getByRole("link", { name: "Charts", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await noImplicitRequests(page);
});

test("unknown child IDs are rejected rather than rendered as a resource section", async ({ page }) => {
  await fixture(page, "not-a-resource");
  await expect(page.getByRole("heading", { level: 2, name: "Cluster", exact: true })).toBeVisible();
  await expect(navigation(page).getByRole("link", { name: "Cluster", exact: true })).toHaveAttribute("aria-current", "page");
  await noImplicitRequests(page);
});
