import { expect, test, type Page } from "@playwright/test";

type Request = Record<string, unknown>;
type Call = { command: string; request: Request };
type Controls = { manyJobs?: boolean; warning?: boolean; failure?: string; pages?: boolean; hold?: boolean; empty?: boolean; oversized?: boolean };
type Fixture = Window & { __overviewCalls: Call[]; __overviewControl: Controls; __overviewRelease: () => void };
const calls = (page: Page) => page.evaluate(() => (window as Fixture).__overviewCalls);

async function fixture(page: Page, control: Controls = {}) {
  page.on("pageerror", error => { throw error; });

  await page.addInitScript(control => {
    const calls: Call[] = [], pending: (() => void)[] = [];
    let nextHandler = 0, menuHandler = 0;
    const handlers = new Map<number, (event: unknown) => void>();
    const item = (name: string, namespace: string | null, status = "Unknown", columns: Record<string, string> = {}) => ({ name, uid: `uid-${name}`, namespace, status, columns, createdAt: "2026-10-01T00:00:00Z", node: null });
    Object.assign(window, { isTauri: true, __overviewCalls: calls, __overviewControl: control,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __overviewRelease: () => pending.splice(0).forEach(resolve => resolve()),
      __TAURI_INTERNALS__: {
        transformCallback: (callback: (event: unknown) => void) => { handlers.set(++nextHandler, callback); return nextHandler; },
        unregisterCallback: (id: number) => handlers.delete(id),
        invoke: async (command: string, args?: { request: Request; handler?: number }) => {
        const request = structuredClone(args?.request ?? {}); calls.push({ command, request });
        if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
          authorizationEpoch: String(request.sessionId), revision: 0, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
          items: (request.checks as unknown[]).map(check => ({ check, decision: "allowed", reason: null })) };
        if (command === "cluster_permissions_cancel" || command === "cluster_permissions_refresh") return null;
        if (command === "plugin:event|listen") { menuHandler = args?.handler ?? 0; return menuHandler; }
        if (command === "plugin:event|unlisten") return null;
        if (command === "row_context_menu_show") {
          handlers.get(menuHandler)?.({ event: "iceon://row-context-menu", id: menuHandler,
            payload: { clusterId: request.clusterId, sessionId: request.sessionId, requestId: request.requestId, action: "details" } });
          return null;
        }
        if (["cluster_namespace_cache_get", "cluster_namespace_cache_refresh"].includes(command)) return { ...request, names: ["team-a", "team-b"], fetchedAt: Date.now(), expiresAt: Date.now() + 60000, partial: false };
         if (command === "cluster_namespace_cache_refresh_cancel") return null;
         if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: request.clusterId, sessionId: request.sessionId ?? "overview-lease", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        if (command.endsWith("_cancel") || command === "cluster_disconnect") return null;
        if (command !== "cluster_resources") throw "invalidInput";
        const kind = request.kind, namespace = String(request.namespace ?? "team-a");
        if (kind === "pods" && control.hold) await new Promise<void>(resolve => pending.push(resolve));
        if (kind === control.failure) throw "permissionDenied";
        let items = kind === "namespaces" ? [item("team-a", null), item("team-b", null)] : control.empty ? [] : [item(`${kind}-${request.continueToken ?? "first"}`, namespace)];
        if (kind === "pods" && !control.empty) items = [item(`pod-${request.continueToken ?? "first"}`, namespace, "Running", { health: "healthy" }), item(`unknown-${request.continueToken ?? "first"}`, namespace, "Running")];
        if (kind === "deployments" && !control.empty) items = [item("ready", namespace, "Unknown", { desired: "3", ready: "3" }), item("unready", namespace, "Unknown", { desired: "3", ready: "2" })];
        if (kind === "jobs" && !control.empty) items = [item("done", namespace, "Completed"), item("active", namespace, "Unknown", { active: "1" })];
        if (kind === "jobs" && control.manyJobs) items = Array.from({ length: 100 }, (_, index) => item(`job-${index}`, namespace, "Completed"));
         if (kind === "cronJobs" && !control.empty) items = [item("scheduled", namespace, "Unknown", { active: "2", schedule: "*/5 * * * *", suspend: "false" })];
        if (kind === "events" && !control.empty) items = Array.from({ length: 12 }, (_, index) => ({ ...item(`event-${index}`, namespace, "Normal", { type: "Normal", reason: `Reason${index}`, message: `Message${index}`, source: "kubelet", count: String(index + 1), lastSeen: index === 0 ? "2026-10-25T00:00:00Z" : index === 11 ? "invalid" : `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`, involvedObject: "Pod/pod-first" }), createdAt: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z` }));
        if (kind === "events" && control.warning && items[11]) { items[11].status = "Warning"; items[11].columns.type = "Warning"; }
         if (kind === "pods" && control.oversized) items = Array.from({ length: 101 }, (_, index) => item(`oversized-${index}`, namespace));
        const token = kind === "pods" && control.pages ? String(Number(request.continueToken ?? 0) + 1) : null;
        return { ...request, namespace: request.namespace ?? null, items, continueToken: token, truncated: token !== null, fetchedAt: Date.now(), metrics: null };
      } },
    });
  }, control);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/cluster/one?section=workloads-overview");
}
const inventory = (page: Page, label: string) => page.getByRole("region", { name: `${label} inventory`, exact: true });

test("uses observed lifecycle language and sorts by creation before limiting the displayed events", async ({ page }) => {
  await fixture(page);
  for (const label of ["Pods", "Deployments", "DaemonSets", "StatefulSets", "ReplicaSets", "Jobs", "CronJobs"]) await expect(inventory(page, label)).toBeVisible();
  await expect(inventory(page, "Pods").getByRole("img")).toHaveAccessibleName("Pods: 2 loaded, Running: 2");
  await expect(inventory(page, "Deployments").getByRole("img")).toHaveAccessibleName("Deployments: 2 loaded, Running: 1, Pending: 1");
  await expect(inventory(page, "Jobs").getByRole("img")).toHaveAccessibleName("Jobs: 2 loaded, Succeeded: 1, Running: 1");
  await expect(inventory(page, "CronJobs").getByRole("img")).toHaveAccessibleName("CronJobs: 1 loaded, Scheduled: 1");
  const table = page.getByRole("table", { name: "Latest events", exact: true });
  await expect(table.getByRole("row")).toHaveCount(11);
  await expect(table.getByRole("row").nth(1)).toContainText("Message11");
  await expect(table.getByRole("row").nth(2)).toContainText("Message10");
  await expect(table.getByRole("cell", { name: "Message1", exact: true })).toHaveCount(0);
  for (const name of ["Type", "Message", "Namespace", "Involved object", "Source", "Count", "Age", "Last seen", "Actions"]) await expect(table.getByRole("columnheader", { name: new RegExp(`^(?:Sort by )?${name}(?: |,|$)`) })).toBeVisible();
  await page.getByRole("button", { name: "About event ordering", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "About event ordering" })).toContainText("not cluster-wide latest events");
  await page.keyboard.press("Escape");
});

test("bounds pagination and isolates per-kind permission errors", async ({ page }) => {
  await fixture(page, { pages: true, failure: "deployments" });
  await expect(inventory(page, "Pods")).toContainText("Partial loaded counts");
  await expect(inventory(page, "Deployments")).toContainText("Kubernetes permissions");
  await expect(page.getByRole("table", { name: "Latest events" })).toBeVisible();
  const observed = await calls(page);
  const cancelled = new Set(observed.filter(call => call.command === "cluster_resources_cancel").map(call => call.request.readId));
  expect(observed.filter(call => call.command === "cluster_resources" && call.request.kind === "pods" && !cancelled.has(call.request.readId))).toHaveLength(5);
  await expect(inventory(page, "Pods").getByRole("link", { name: "Pods", exact: true })).toHaveAttribute("href", "#/cluster/one?section=pods");
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
  await page.getByRole("button", { name: /^Namespace(?: \d+)?$/ }).click();
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

test("event relationships resolve through the backend instead of guessing object identities", async ({ page }) => {
  await fixture(page);
  const table = page.getByRole("table", { name: "Latest events" });
  await expect(table).toBeVisible();
  await table.getByRole("button", { name: "Pod/pod-first", exact: true }).first().click();
  await expect.poll(async () => (await calls(page)).filter(call => call.command === "cluster_resource_detail").map(call => call.request.reference)).toContainEqual({ kind: "events", namespace: "team-a", name: "event-11", uid: "uid-event-11" });
});

test("rejects oversized API pages instead of inventing an unbounded total", async ({ page }) => {
  await fixture(page, { oversized: true });
  await expect(inventory(page, "Pods").getByRole("alert")).toBeVisible();
  await expect(inventory(page, "Pods").getByRole("img")).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Latest events" })).toBeVisible();
});

test("event row keyboard menu offers only scoped details", async ({ page }) => {
  await fixture(page);
  const row = page.getByRole("table", { name: "Latest events" }).getByRole("row").nth(1);
  await row.focus();
  await page.keyboard.press("Shift+F10");
  await expect.poll(async () => (await calls(page)).filter(call => call.command === "row_context_menu_show").length).toBe(1);
  const menu = (await calls(page)).find(call => call.command === "row_context_menu_show")!.request;
  expect(menu.actions).toEqual(["details"]);
  expect(menu.target).toEqual({ type: "resource", reference: { kind: "events", namespace: "team-a", name: "event-11", uid: "uid-event-11" } });
  await expect.poll(async () => (await calls(page)).filter(call => call.command === "cluster_resource_detail").length).toBeGreaterThan(0);
  expect((await calls(page)).some(call => call.command === "cluster_resource_delete")).toBe(false);
});

for (const theme of ["light", "dark"] as const) test(`lifecycle chart toggles and warning event styling in ${theme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme });
  await fixture(page, { warning: true });
  const pods = inventory(page, "Pods");
  await pods.getByRole("button", { name: "Running: 2", exact: true }).click();
  await expect(pods.getByRole("button", { name: "Running: 2", exact: true })).toHaveAttribute("aria-pressed", "false");
  await pods.getByRole("button", { name: "Running: 2", exact: true }).press("Space");
  await expect(pods.getByRole("button", { name: "Running: 2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(pods.getByRole("link", { name: "Open Pods", exact: true })).toHaveAttribute("href", "#/cluster/one?section=pods");
  const table = page.getByRole("table", { name: "Latest events" });
  const warning = table.getByRole("button", { name: "Message11", exact: true });
  expect(await warning.evaluate(element => getComputedStyle(element).color)).toBe(await warning.evaluate(element => {
    const probe = document.createElement("i"); probe.style.color = "var(--color-text-red)"; element.append(probe);
    const color = getComputedStyle(probe).color; probe.remove(); return color;
  }));
  const headerBox = (await page.getByRole("heading", { name: "Workloads overview", exact: true }).boundingBox())!;
  const sectionBox = (await page.getByRole("region", { name: "Workload status", exact: true }).boundingBox())!;
  expect(sectionBox.y - headerBox.y - headerBox.height).toBeLessThan(36);
  const legend = pods.getByRole("button", { name: "Running: 2", exact: true });
  await expect(legend).toHaveCSS("border-left-width", "0px");
  await page.getByRole("button", { name: "Next events", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous events", exact: true }).click();
  await page.screenshot({ path: `/tmp/iceon-workloads-${theme}.png` });
  await table.getByRole("columnheader", { name: /Last seen/ }).getByRole("button").press("Enter");
  await expect(table.getByRole("columnheader", { name: /Last seen/ })).toHaveAttribute("aria-sort", "ascending");
  await table.getByRole("columnheader", { name: /Last seen/ }).getByRole("button").press("Enter");
  await expect(table.getByRole("row").nth(1)).toContainText("Message0");
  const states = await page.evaluate(async () => {
    const { workloadStatus } = await import("/src/app/cluster/WorkloadsOverview.tsx" as string);
    const item = (status: string, columns: Record<string, string>) => ({ name: "test", status, columns });
    return [workloadStatus("pods", item("Succeeded", {})), workloadStatus("pods", item("Evicted", {})),
      workloadStatus("pods", item("Running", { health: "terminating" })),
      workloadStatus("replicaSets", item("Unknown", { desired: "0" })),
      workloadStatus("replicaSets", item("Unknown", {})), workloadStatus("cronJobs", item("Unknown", { schedule: "* * * * *" })),
      workloadStatus("cronJobs", item("Unknown", { suspend: "true" })), workloadStatus("jobs", item("Unknown", { failed: "1" }))];
  });
  expect(states).toEqual(["Succeeded", "Failed", "Terminating", "Running", "Unknown", "Scheduled", "Suspended", "Unknown"]);
});

for (const theme of ["light", "dark"] as const) test(`compact color-key legends preserve long labels and narrow reflow in ${theme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await fixture(page, { manyJobs: true });
  const legend = inventory(page, "Jobs").getByRole("button", { name: "Succeeded: 100", exact: true });
  await expect(legend).toBeVisible();
  await expect(legend).toHaveCSS("border-left-width", "0px");
  const label = legend.getByText("Succeeded: 100", { exact: true });
  expect(await label.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return text.left >= bounds.left - 1 && text.right <= bounds.right + 1;
  })).toBe(true);
  const box = (await label.boundingBox())!;
  const control = (await legend.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(control.x + control.width);
  expect(box.y + box.height).toBeLessThanOrEqual(control.y + control.height);
  await page.setViewportSize({ width: 390, height: 844 });
  await legend.scrollIntoViewIfNeeded();
  await expect(legend).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await legend.press("Enter");
  await expect(legend).toHaveAttribute("aria-pressed", "false");
  await legend.press("Space");
  await expect(legend).toHaveAttribute("aria-pressed", "true");
});

test("event ordering matches displayed fallback types and keeps unknown times last", async ({ page }) => {
  await page.goto("/");
  const sorted = await page.evaluate(async () => {
    const { compareEvents } = await import("/src/app/cluster/WorkloadsOverview.tsx" as string);
    const rows = [
      { name: "missing", status: "Warning", columns: {}, createdAt: "2026-10-30T00:00:00Z" },
      { name: "older", status: "Normal", columns: { type: "Normal", lastSeen: "2026-10-01T00:00:00Z" } },
      { name: "newer", status: "Normal", columns: { type: "Normal", lastSeen: "2026-10-02T00:00:00Z" } },
    ];
    return ["ascending", "descending"].flatMap(direction => ["lastSeen", "type"].map(key => [...rows].sort((a, b) => compareEvents(a, b, key, direction)).map(row => row.name)));
  });
  expect(sorted).toEqual([["older", "newer", "missing"], ["newer", "older", "missing"], ["newer", "older", "missing"], ["missing", "newer", "older"]]);
});
