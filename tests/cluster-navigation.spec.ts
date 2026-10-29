import { expect, test, type Page } from "@playwright/test";
import { clusterSections } from "../src/app/cluster/navigation";
import { resourceViews } from "../src/app/cluster/resourceViews";

test("group labels toggle their children without opening a landing page", async ({ page }) => {
  await fixture(page);
  const nav = navigation(page);
  for (const group of clusterSections.filter(item => "children" in item)) {
    await nav.getByText(group.label, { exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/section=overview$/);
    await expect(nav.getByRole("link", { name: group.label, exact: true })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: `Collapse ${group.label}`, exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link", { name: group.children[0].label, exact: true })).toBeVisible();
    await nav.getByText(group.label, { exact: true }).filter({ visible: true }).click();
    await expect(nav.getByRole("button", { name: `Expand ${group.label}`, exact: true })).toHaveAttribute("aria-expanded", "false");
  }
  await onlyReadRequests(page);
});

async function fixture(page: Page, section = "overview", narrow = false) {
  page.on("pageerror", (error) => { throw error; });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, { isTauri: true, __navigationCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
        calls.push(command);
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev-context", source: "kubeconfig", labels: ["file=/fixtures/config"], color: "#476BA1", status: "disconnected", pinned: false },
        ] };
        if (command === "cluster_permissions_review") {
          const review = args?.request as unknown as { clusterId: string; sessionId: string; readId: number; checks: unknown[] };
          const checkedAt = Date.now();
          return { clusterId: review.clusterId, sessionId: review.sessionId, readId: review.readId,
            authorizationEpoch: `fixture-${review.sessionId}`, revision: review.readId, checkedAt, expiresAt: checkedAt + 30_000,
            items: review.checks.map(check => ({ check, decision: "allowed", reason: null })) };
        }
        if (command === "cluster_permissions_cancel" || command === "cluster_permissions_refresh") return null;
        if (command === "cluster_session_open") return { clusterId: args?.request.clusterId, sessionId: crypto.randomUUID(), contextName: "dev-context", status: "disconnected", apiVersion: null, error: null };
        if (["cluster_disconnect", "cluster_resources_cancel", "helm_cancel"].includes(command)) return;
        if (command === "cluster_connect") return { ...args?.request, contextName: "dev-context", status: "connected", apiVersion: "v1.35.8", error: null };
        if (command === "cluster_resources") return { ...args?.request, namespace: args?.request.namespace ?? null,
          continueToken: null, metrics: null, items: args?.request.kind === "namespaces" ? ["team-a", "team-b", "production", "default"].map(name => ({ name, namespace: null, status: "Active", createdAt: null, node: null, columns: {} })) : [], truncated: false, fetchedAt: 1793000000000 };
        if (command === "cluster_custom_resource_definitions") return { ...args?.request, kind: "customResourceDefinitions", namespace: null, metrics: null, items: [], continueToken: null, truncated: false, fetchedAt: 1793000000000 };
        if (command === "cluster_custom_resource_definitions_cancel") return;
        if (command === "helm_table") return { ...args?.request, items: [], truncated: false };
        if (command === "cluster_pod_forward_list") return [];
        throw new Error(`Unexpected IPC: ${command}`);
      },
    } });
  });
  await page.setViewportSize({ width: narrow ? 360 : 1200, height: 800 });
  await page.goto(`/#/cluster/one?section=${section}`);
  if (section === "overview" || section === "not-a-resource") await expect(page.getByRole("heading", { name: "Cluster overview", exact: true })).toBeVisible();
  else await expect(page.getByRole("table", { name: "Deployments", exact: true })).toBeVisible();
}
const navigation = (page: Page) => page.getByRole("navigation", { name: "Cluster navigation", exact: true });
async function onlyReadRequests(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __navigationCalls: string[] }).__navigationCalls);
  expect(calls.every((command) => ["catalog_list", "cluster_session_open", "cluster_disconnect", "cluster_connect", "cluster_resources", "cluster_resources_cancel", "helm_table", "helm_cancel", "cluster_pod_forward_list", "cluster_custom_resource_definitions", "cluster_custom_resource_definitions_cancel", "cluster_permissions_review", "cluster_permissions_cancel", "cluster_permissions_refresh"].includes(command))).toBe(true);
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
  await expect(nav.getByRole("button", { name: "Pin Workloads for Development", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("link", { name: "Overview", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("button", { name: "Pin Overview for Development", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/section=pods$/);
  await expect(nav.getByRole("link", { name: "Pods", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("table", { name: "Pods", exact: true })).toBeVisible();
  await onlyReadRequests(page);
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
  await onlyReadRequests(page);
});

for (const group of clusterSections.filter((section) => "children" in section)) {
  test(`${group.label}: exposes its children with resource tables or destination directories`, async ({ page }) => {
    await fixture(page);
    const nav = navigation(page);
    await nav.getByRole("button", { name: `Expand ${group.label}`, exact: true }).click();
    for (const child of group.children) {
      await nav.getByRole("link", { name: child.label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`section=${child.id}$`));
      await expect(page.getByRole("heading", { level: 1, name: `Development · ${child.label}`, exact: true })).toBeAttached();
      const view = resourceViews.find(view => view.section === child.id);
      const tableName = child.id === "helm-charts" ? "Helm Charts" : child.id === "helm-releases" ? "Helm Releases"
        : child.id === "port-forwarding" ? "Port forwards" : view?.label ?? `${child.label} destinations`;
      if (child.id === "workloads-overview") await expect(page.getByRole("heading", { name: "Workloads overview", exact: true })).toBeVisible();
      else if (child.id === "users") await expect(page.getByRole("heading", { name: "Choose a user namespace", exact: true })).toBeVisible();
      else if (tableName.endsWith(" destinations")) await expect(page.getByRole("navigation", { name: tableName, exact: true })).toBeVisible();
      else await expect(page.getByRole("table", { name: tableName, exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: child.label, exact: true })).toHaveAttribute("aria-current", "page");
    }
    await nav.getByRole("button", { name: `Collapse ${group.label}`, exact: true }).click();
    await onlyReadRequests(page);
  });
}

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
  await expect(page.getByRole("table", { name: "Helm Charts", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(nav.getByRole("link", { name: "Charts", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await onlyReadRequests(page);
});

test("unknown child IDs are rejected rather than rendered as a resource section", async ({ page }) => {
  await fixture(page, "not-a-resource");
  await expect(page.getByRole("heading", { name: "Cluster overview", exact: true })).toBeVisible();
  await expect(navigation(page).getByRole("link", { name: "Cluster", exact: true })).toHaveAttribute("aria-current", "page");
  await onlyReadRequests(page);
});
