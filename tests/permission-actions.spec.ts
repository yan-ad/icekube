import { installNamespaceSnapshotMock } from "./helpers/namespaceSnapshotMock";
import { expect, test, type Page } from "@playwright/test";
import type { PermissionCheck, PermissionReviewRequest } from "../src/app/cluster/permissionsApi";

type Call = { command: string; request: Record<string, any> };
type Fixture = Window & { __permissionActionCalls: Call[]; __permissionActionEmit: (payload: Record<string, unknown>) => void; __permissionActionUnexpected: string[] };
const calls = (page: Page, command: string) => page.evaluate(command => (window as Fixture).__permissionActionCalls.filter(call => call.command === command), command);
const inspector = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });

test("all-namespaces denial keeps the chooser and filters available for an allowed namespace", async ({ page }) => {
  await fixture(page, "namespaceOnly", "deployments");
  await expect(page.getByText("Access denied", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Deployments", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Namespace options", exact: true }).click();
  await page.getByRole("button", { name: "Enter namespace", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Known namespace", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Deployments", exact: true })).toHaveCount(0);
  await expect(page.getByText("No deployments were returned.", { exact: true })).toHaveCount(0);
  expect(await calls(page, "cluster_resources")).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Search Deployments", exact: true }).fill("api");
  await namespace(page, "team-a");
  await expect(page.getByRole("table", { name: "Deployments", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search Deployments", exact: true })).toHaveValue("api");
  const reads = await calls(page, "cluster_resources");
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(call => call.request.kind === "deployments" && call.request.namespace === "team-a" && call.request.query === "api")).toBe(true);
  expect((await calls(page, "cluster_permissions_review")).flatMap(call => call.request.checks).some(check => check.kind === "deployments" && check.namespace === "team-a" && check.action === "list")).toBe(true);
  await expectReadOnlyWarning(page);
  await noMutations(page);
  await namespace(page, "team-b");
  await expect(page.getByText("Access denied", { exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Deployments", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Search Deployments", exact: true })).toHaveValue("api");
  expect(await calls(page, "cluster_resources")).toEqual(reads);
});

async function fixture(page: Page, mode: "readOnly" | "denied" | "unknown" | "namespaceOnly" = "readOnly", section = "pods") {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(({ mode }) => {
    const calls: Call[] = [], unexpected: string[] = [];
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let next = 0;
    const decision = (check: PermissionCheck) => mode === "unknown" ? "unknown" : mode === "denied" || check.kind === "namespaces" || check.namespace === "team-b" || mode === "namespaceOnly" && check.namespace !== "team-a" ? "denied" : ["list", "get", "logs"].includes(check.action) ? "allowed" : "denied";
    Object.assign(window, { isTauri: true, __permissionActionCalls: calls, __permissionActionUnexpected: unexpected,
      __permissionActionEmit: (payload: Record<string, unknown>) => {
        for (const [id, listener] of listeners) if (listener.event === "iceon://row-context-menu") callbacks.get(listener.handler)?.({ event: listener.event, id, payload });
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => listeners.delete(id) },
      __TAURI_INTERNALS__: {
        transformCallback: (callback: (event: unknown) => void) => { const id = ++next; callbacks.set(id, callback); return id; },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (command: string, args?: Record<string, any>) => {
          const request = structuredClone(args?.request ?? {}); calls.push({ command, request });
          if (command === "cluster_permissions_review") {
            const review = request as PermissionReviewRequest;
            return { clusterId: review.clusterId, sessionId: review.sessionId, readId: review.readId, authorizationEpoch: `fixture-epoch-${review.sessionId}`, revision: review.readId, checkedAt: Date.now(), expiresAt: Date.now() + 30000,
              items: review.checks.map(check => ({ check, decision: decision(check), reason: mode === "unknown" ? "reviewUnavailable" : null })) };
          }
          if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
          if (command === "catalog_connection_states") return [];
          if (command === "preferences_get") return null;
          if (command === "update_state") return { phase: "idle", version: null, error: null };
          if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: "one", sessionId: "permission-session", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
          if (command === "plugin:event|listen") { const id = ++next; listeners.set(id, { event: args!.event, handler: args!.handler }); return id; }
          if (command === "plugin:event|unlisten") { listeners.delete(args!.eventId); return null; }
          if (["cluster_permissions_cancel", "cluster_resources_cancel", "cluster_disconnect", "cluster_pod_detail_cancel", "cluster_resource_detail_cancel", "cluster_pod_stream_close", "row_context_menu_show", "row_context_menu_cancel"].includes(command)) return null;
          if (command === "cluster_resources") {
            if (request.kind === "namespaces") throw "permissionDenied";
            return { ...request, namespace: request.namespace ?? null, items: [{ name: "api-pod", namespace: request.namespace ?? "team-a", uid: "pod-uid", resourceVersion: "11", createdAt: null, status: "Running", columns: {}, node: null }], continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null };
          }
          if (command === "cluster_pod_detail") return { ...request, uid: "pod-uid", resourceVersion: "11", phase: "Running", node: null, podIps: [], hostIps: [], serviceAccount: null, qos: null, createdAt: null, deletionTimestamp: null, conditions: [], events: [],
            containers: [{ name: "app", image: "fixture/app:v1", kind: "container", state: "running", ready: true, restarts: 0, ports: [] }], yaml: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: api-pod\n  namespace: team-a\n" };
          if (command === "cluster_pod_stream_open" || command === "cluster_pod_stream_read") return { clusterId: "one", sessionId: "permission-session", streamId: "logs-stream", sequence: command === "cluster_pod_stream_open" ? 0 : 1, output: "fixture log\n", status: "exited", error: null, truncated: false };
          unexpected.push(command); throw `Unexpected permission fixture command: ${command}`;
        },
      },
    });
  }, { mode });
  await page.setViewportSize({ width: 1440, height: 900 });
  await installNamespaceSnapshotMock(page);
  await page.goto(`/#/cluster/one?section=${section}`);
}
async function namespace(page: Page, value: string) {
  if (!await page.getByRole("textbox", { name: "Known namespace", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Namespace options", exact: true }).click();
    await page.getByRole("button", { name: "Enter namespace", exact: true }).click();
  }
  await page.getByRole("textbox", { name: "Known namespace", exact: true }).fill(value);
  await page.getByRole("button", { name: "Use namespace", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Namespace options", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Namespace options", exact: true })).toBeFocused();
}
async function expectReadOnlyWarning(page: Page) {
  await page.getByRole("button", { name: "Namespace options", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Read-only access. Your Kubernetes permissions allow viewing these resources, but not changing them.");
  await expect(page.getByRole("status").filter({ hasText: "Read-only access." })).toHaveCount(0);
}
async function noMutations(page: Page) {
  for (const command of ["cluster_resource_create", "cluster_resource_delete", "cluster_pod_mutate", "cluster_pod_forward_start"]) expect(await calls(page, command)).toEqual([]);
  expect((await calls(page, "cluster_pod_stream_open")).every(call => call.request.mode === "logs")).toBe(true);
}
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as Fixture).__permissionActionUnexpected ?? [])).toEqual([]);
});

test("read-only namespace input scopes reads, shows the notice, and cannot submit mutations", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("table", { name: "Pods", exact: true })).toBeVisible();
  expect((await calls(page, "cluster_resources")).some(call => call.request.kind === "namespaces")).toBe(false);
  await namespace(page, "team-a");
  await expect.poll(async () => (await calls(page, "cluster_resources")).filter(call => call.request.kind === "pods").at(-1)?.request.namespace).toBe("team-a");
  await expectReadOnlyWarning(page);
  await expect(page.getByRole("button", { name: "Create Pod", exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select team-a/api-pod", exact: true }).check();
  await expect(page.getByRole("button", { name: "Delete selected resources", exact: true })).toBeDisabled();
  const reviews = await calls(page, "cluster_permissions_review");
  expect(reviews.flatMap(call => call.request.checks).some(check => check.kind === "pods" && check.action === "create" && check.namespace === "team-a")).toBe(true);
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Enable live sync", exact: true })).toBeDisabled();
  expect(await calls(page, "cluster_pod_sync_open")).toEqual([]);
  await noMutations(page);
});

test("Pod logs stay available while Shell and forged native mutation selections are rejected", async ({ page }) => {
  await fixture(page); await namespace(page, "team-a");
  const table = page.getByRole("table", { name: "Pods", exact: true });
  await table.getByRole("button", { name: "api-pod", exact: true }).click();
  await expect(inspector(page).getByRole("button", { name: "Logs", exact: true })).toBeEnabled();
  await expect(inspector(page).getByRole("button", { name: "Shell", exact: true })).toHaveCount(0);
  await expect(inspector(page).getByRole("button", { name: "Edit YAML", exact: true })).toBeDisabled();
  await inspector(page).getByRole("button", { name: "Logs", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).length).toBeGreaterThan(0);
  expect((await calls(page, "cluster_pod_stream_open")).at(-1)!.request).toMatchObject({ namespace: "team-a", name: "api-pod", uid: "pod-uid", mode: "logs" });
  for (const action of ["delete", "shell", "edit", "attach", "forward"]) {
    const before = (await calls(page, "row_context_menu_show")).length;
    await table.getByRole("button", { name: "Actions for api-pod", exact: true }).click();
    await expect.poll(async () => (await calls(page, "row_context_menu_show")).length).toBe(before + 1);
    const menu = (await calls(page, "row_context_menu_show")).at(-1)!.request;
    expect(menu.actions).toEqual(["details", "logs"]);
    await page.evaluate(({ menu, action }) => (window as Fixture).__permissionActionEmit({ clusterId: menu.clusterId, sessionId: menu.sessionId, requestId: menu.requestId, action }), { menu, action });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await noMutations(page);
});

for (const mode of ["denied", "unknown"] as const) test(`${mode} review leaves mutations inaccessible on a direct resource route`, async ({ page }) => {
  await fixture(page, mode, "deployments");
  if (mode === "denied") await expect(page.getByText("Access denied", { exact: true })).toBeVisible();
  else {
    await page.getByRole("button", { name: "Namespace options", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toContainText("Access unverified. Permission review is unavailable; Kubernetes still checks each request. Changes are disabled until access is verified.");
  }
  await expect(page.getByRole("button", { name: "Create Deployment", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete selected resources", exact: true })).toHaveCount(0);
  if (mode === "denied") expect(await calls(page, "cluster_resources")).toEqual([]);
  else {
    await expect(page.getByRole("table", { name: "Deployments", exact: true })).toBeVisible();
    expect((await calls(page, "cluster_resources")).some(call => call.request.kind === "deployments")).toBe(true);
  }
  await noMutations(page);
});
