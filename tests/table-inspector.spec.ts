import { expect, test, type Page } from "@playwright/test";

type Call = { command: string; request: Record<string, unknown> };
async function fixture(page: Page, section: string) {
  await page.addInitScript(() => {
    const calls: Call[] = [];
    let inventory: Record<string, unknown>[] = [];
    const usage = { used: null, allocatable: null, capacity: null };
    Object.assign(window, { isTauri: true, __inspectorCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
        const request = args?.request ?? {};
        calls.push({ command, request });
        if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
          authorizationEpoch: String(request.sessionId), revision: 0, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
          items: (request.checks as unknown[]).map(check => ({ check, decision: "allowed", reason: null })) };
        if (command === "cluster_permissions_cancel" || command === "cluster_permissions_refresh") return null;
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "cluster_session_open" || command === "cluster_connect") return {
          clusterId: request.clusterId, sessionId: request.sessionId ?? "lease-one", contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: "v1.35.8", error: null,
        };
        if (["cluster_disconnect", "cluster_resources_cancel", "helm_cancel"].includes(command)) return;
        if (command === "cluster_resources") {
          const common = { namespace: null, createdAt: null, columns: {}, node: null };
          const items = request.kind === "nodes" ? [
            { ...common, name: "node-a", uid: "node-uid", status: "Ready", node: {
              roles: [], taints: 0, version: null, internalIps: [], schedulable: true, diskAllocatable: null,
              metricsTimestamp: null, cpu: usage, memory: usage,
              conditions: [{ type: "Ready", status: "True" }, { type: "MemoryPressure", status: "False" }, { type: "CustomCondition", status: "Unknown" }],
            } },
            { ...common, name: "node-b", uid: "node-b-uid", status: "NotReady", node: {
              roles: [], taints: 0, version: null, internalIps: [], schedulable: false, diskAllocatable: null,
              metricsTimestamp: null, cpu: usage, memory: usage,
              conditions: [{ type: "Ready", status: "False" }, { type: "DiskPressure", status: "True" }],
            } },
          ] : request.kind === "namespaces" ? [
            { ...common, name: "team-a", uid: "namespace-uid", status: "Active" },
            { ...common, name: "unknown-space", uid: "unknown-uid", status: "Unknown" },
          ] : [];
          inventory = items;
          return { ...request, namespace: request.namespace ?? null, items, truncated: false, continueToken: null,
            fetchedAt: Date.now(), metrics: request.kind === "nodes" ? "unavailable" : null };
        }
        if (command === "cluster_resource_detail") {
          const reference = request.reference as { name: string };
          return { ...request, item: { ...inventory.find(item => item.name === reference.name), resourceVersion: "1" }, related: {} };
        }
        if (command === "cluster_resource_detail_cancel") return;
        if (command === "cluster_pod_detail") return { ...request, uid: "pod-uid", resourceVersion: "1",
          phase: "Running", node: "node-a", podIps: [], hostIps: [], serviceAccount: "default", qos: "Burstable",
          createdAt: null, deletionTimestamp: null, containers: [], conditions: [], events: [], yaml: "apiVersion: v1\nkind: Pod\n" };
        if (command === "helm_table") return { ...request, truncated: false, items: request.view === "charts" ? [
          { id: "stable/chart", name: "stable/chart", namespace: null, version: "1.2.3", appVersion: "4.5.6", description: "Chart metadata", status: null, revision: null, updated: null },
        ] : [
          { id: "release-a", name: "release-a", namespace: "team-a", version: "chart-1.2.3", appVersion: "4.5.6", description: null, status: "failed", revision: 3, updated: "2026-10-26" },
        ] };
        if (command === "cluster_pod_forward_list") return [{ ...request, id: "forward-one", namespace: "team-a", name: "pod-a", remotePort: 8080, localPort: 18080, status: "running", error: null }];
        throw "notFound";
      },
    } });
  });
  await page.setViewportSize({ width: 1563, height: 900 });
  await page.goto(`/#/cluster/one?section=${section}`);
}

const table = (page: Page, name: string) => page.getByRole("table", { name, exact: true });
const badge = (page: Page, name: string, label: string) => table(page, name).locator(".astryx-badge").filter({ hasText: new RegExp(`^${label}$`) });

test("node condition and schedulability badges distinguish adverse conditions from normal and unknown", async ({ page }) => {
  await fixture(page, "nodes");
  await expect(badge(page, "Nodes", "Ready")).toHaveAttribute("data-variant", "success");
  await expect(badge(page, "Nodes", "MemoryPressure: False")).toHaveCount(0);
  await expect(badge(page, "Nodes", "CustomCondition: Unknown")).toHaveCount(0);
  await expect(table(page, "Nodes").getByRole("button", { name: "+2 conditions", exact: true })).toBeVisible();
  await expect(badge(page, "Nodes", "Ready: False")).toHaveAttribute("data-variant", "error");
  await expect(badge(page, "Nodes", "DiskPressure: True")).toHaveAttribute("data-variant", "warning");
  await expect(badge(page, "Nodes", "True")).toHaveAttribute("data-variant", "neutral");
  await expect(badge(page, "Nodes", "False")).toHaveAttribute("data-variant", "warning");
  const name = table(page, "Nodes").getByRole("button", { name: "node-a", exact: true });
  await name.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toBeVisible();
  const inspector = page.getByRole("region", { name: "Resource details", exact: true });
  await expect(inspector).toContainText("node-a");
  await expect(inspector.getByText("MemoryPressure: False", { exact: true })).toBeVisible();
  await expect(inspector.getByText("CustomCondition: Unknown", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("alert")).toHaveCount(0);
  await expect(table(page, "Nodes").getByRole("checkbox", { name: "Select node-a", exact: true })).not.toBeChecked();
});

test("namespace names inspect the namespace and unknown state stays neutral", async ({ page }) => {
  await fixture(page, "namespaces");
  await expect(badge(page, "Namespaces", "Active")).toHaveAttribute("data-variant", "success");
  await expect(badge(page, "Namespaces", "Unknown")).toHaveAttribute("data-variant", "neutral");
  await table(page, "Namespaces").getByRole("button", { name: "team-a", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toContainText("team-a");
});

for (const view of ["charts", "releases"] as const) test(`Helm ${view} inspect actual inventory metadata without requesting a guessed Kubernetes resource`, async ({ page }) => {
  await fixture(page, `helm-${view}`);
  const grid = table(page, view === "charts" ? "Helm Charts" : "Helm Releases");
  if (view === "releases") await expect(badge(page, "Helm Releases", "failed")).toHaveAttribute("data-variant", "error");
  await grid.getByRole("button", { name: view === "charts" ? "stable/chart" : "release-a", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toContainText(view === "charts" ? "Chart metadata" : "chart-1.2.3");
  const requests = await page.evaluate(() => (window as unknown as { __inspectorCalls: Call[] }).__inspectorCalls);
  expect(requests.filter(call => call.command === "cluster_resources" && call.request.kind !== "namespaces")).toHaveLength(0);
});

test("port-forward name and related Pod inspect the exact Pod rather than treating the address as a link", async ({ page }) => {
  await fixture(page, "port-forwarding");
  await expect(badge(page, "Port forwards", "running")).toHaveAttribute("data-variant", "success");
  const grid = table(page, "Port forwards");
  await expect(grid.getByRole("link")).toHaveCount(0);
  await grid.getByRole("button", { name: "forward-one", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toContainText("pod-a");
  await page.keyboard.press("Escape");
  await grid.getByRole("button", { name: "pod-a", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resource details", exact: true })).toContainText("pod-a");
});
