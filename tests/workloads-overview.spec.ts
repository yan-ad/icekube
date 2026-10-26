import { expect, test, type Page } from "@playwright/test";

type Request = Record<string, unknown>;
type Call = { command: string; request: Request };
type Controls = { failure?: string; pages?: boolean; hold?: boolean; empty?: boolean };
type Fixture = Window & { __overviewCalls: Call[]; __overviewControl: Controls; __overviewRelease: () => void };
const calls = (page: Page) => page.evaluate(() => (window as Fixture).__overviewCalls);

async function fixture(page: Page, control: Controls = {}) {
  page.on("pageerror", error => { throw error; });

test("event relationships resolve through the backend instead of guessing object identities", async ({ page }) => {
  await fixture(page);
  const table = page.getByRole("table", { name: "Latest events" });
  await expect(table).toBeVisible();
  await table.getByRole("button", { name: "Pod/pod-first", exact: true }).first().click();
  await expect.poll(async () => (await calls(page)).filter(call => call.command === "cluster_resource_detail").map(call => call.request.reference)).toContainEqual({ kind: "events", namespace: "team-a", name: "event-11", uid: "uid-event-11" });
});
  await page.addInitScript(control => {
    const calls: Call[] = [], pending: (() => void)[] = [];
    const item = (name: string, namespace: string | null, status = "Unknown", columns: Record<string, string> = {}) => ({ name, uid: `uid-${name}`, namespace, status, columns, createdAt: "2026-10-01T00:00:00Z", node: null });
    Object.assign(window, { isTauri: true, __overviewCalls: calls, __overviewControl: control,
      __overviewRelease: () => pending.splice(0).forEach(resolve => resolve()),
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Request }) => {
        const request = structuredClone(args?.request ?? {}); calls.push({ command, request });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: request.clusterId, sessionId: request.sessionId ?? "overview-lease", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        if (command.endsWith("_cancel") || command === "cluster_disconnect") return null;
        if (command !== "cluster_resources") throw "invalidInput";
        const kind = request.kind, namespace = String(request.namespace ?? "team-a");
        if (kind === "pods" && control.hold) await new Promise<void>(resolve => pending.push(resolve));
        if (kind === control.failure) throw "permissionDenied";
        let items = kind === "namespaces" ? [item("team-a", null), item("team-b", null)] : control.empty ? [] : [item(`${kind}-${request.continueToken ?? "first"}`, namespace)];
        if (kind === "pods" && !control.empty) items = [item(`pod-${request.continueToken ?? "first"}`, namespace, "Running", { health: "healthy" }), item(`unknown-${request.continueToken ?? "first"}`, namespace, "Running")];
        if (kind === "events" && !control.empty) items = Array.from({ length: 12 }, (_, index) => ({ ...item(`event-${index}`, namespace, "Normal", { type: "Normal", reason: `Reason${index}`, involvedObject: "Pod/pod-first" }), createdAt: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z` }));
        const token = kind === "pods" && control.pages ? String(Number(request.continueToken ?? 0) + 1) : null;
        return { ...request, namespace: request.namespace ?? null, items, continueToken: token, truncated: token !== null, fetchedAt: Date.now(), metrics: null };
      } },
    });
  }, control);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/cluster/one?section=workloads-overview");
}
const inventory = (page: Page, label: string) => page.getByRole("region", { name: `${label} inventory`, exact: true });

test("uses real loaded counts and never turns unknown Running metadata green", async ({ page }) => {
  await fixture(page);
  for (const label of ["Pods", "Deployments", "DaemonSets", "StatefulSets", "ReplicaSets", "Jobs", "CronJobs"]) await expect(inventory(page, label)).toBeVisible();
  await expect(inventory(page, "Pods").getByRole("img")).toHaveAccessibleName("Pods: 2 loaded, Ready: 1, Unknown: 1");
  await expect(inventory(page, "Deployments").getByRole("img")).toHaveAccessibleName("Deployments: 1 loaded, Unknown: 1");
  const table = page.getByRole("table", { name: "Latest events", exact: true });
  await expect(table.getByRole("row")).toHaveCount(11);
  await expect(table).toContainText("Reason11"); await expect(table).not.toContainText("Reason0");
  await expect(page.getByText(/not last occurrence/)).toBeVisible();
});

test("bounds pagination and isolates per-kind permission errors", async ({ page }) => {
  await fixture(page, { pages: true, failure: "deployments" });
  await expect(inventory(page, "Pods")).toContainText("Partial loaded counts");
  await expect(inventory(page, "Deployments")).toContainText("Kubernetes permissions");
  await expect(page.getByRole("table", { name: "Latest events" })).toBeVisible();
  expect((await calls(page)).filter(call => call.command === "cluster_resources" && call.request.kind === "pods")).toHaveLength(5);
  await expect(inventory(page, "Pods").getByRole("link")).toHaveAttribute("href", "#/cluster/one?section=pods");
});

test("refresh retains stale inventory on failure and empty results remain explicit", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("table", { name: "Latest events" })).toBeVisible();
  await page.evaluate(() => { (window as Fixture).__overviewControl.failure = "pods"; });
  await page.keyboard.press("ControlOrMeta+r");
  await expect(inventory(page, "Pods")).toContainText("Retained data is stale");
  await expect(inventory(page, "Pods").getByRole("img")).toHaveAccessibleName(/2 loaded/);
});

test("cancels the exact pending read on namespace change and ignores late completion", async ({ page }) => {
  await fixture(page, { hold: true });
  await expect.poll(async () => (await calls(page)).filter(call => call.command === "cluster_resources" && call.request.kind === "pods").length).toBeGreaterThan(0);
  const pending = (await calls(page)).filter(call => call.command === "cluster_resources" && call.request.kind === "pods").at(-1)!;
  expect((await calls(page)).some(call => call.command === "cluster_resources" && call.request.kind === "deployments")).toBe(false);
  await page.getByRole("button", { name: /^Namespace/ }).click();
  await page.getByRole("option", { name: "team-b", exact: true }).click();
  await expect.poll(async () => (await calls(page)).filter(call => call.command === "cluster_resources_cancel").map(call => call.request)).toContainEqual(pending.request);
  await page.evaluate(() => { (window as Fixture).__overviewControl.hold = false; (window as Fixture).__overviewRelease(); });
  await expect(page.getByRole("table", { name: "Latest events" })).toBeVisible();
  const reads = (await calls(page)).filter(call => call.command === "cluster_resources" && call.request.kind === "deployments");
  expect(reads.every(call => call.request.namespace === "team-b")).toBe(true);
});

test("empty inventories show zero donuts without claiming healthy resources", async ({ page }) => {
  await fixture(page, { empty: true });
  await expect(inventory(page, "Pods")).toContainText("No pods returned.");
  await expect(inventory(page, "Pods").getByRole("img")).toHaveAccessibleName("Pods: 0 loaded");
  await expect(page.getByText("No events returned.")).toBeVisible();
});
