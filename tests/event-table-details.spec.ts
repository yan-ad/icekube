import { expect, test, type Page } from "@playwright/test";

// Freelens cd07118f843c4a69f937a319a37a7c12ef2c92d8, events/events.tsx:
// diagnostic columns in the existing shared table; Rust owns previews and detail lookup.
type Request = Record<string, any>;
type Call = { command: string; request: Request };
type FixtureWindow = Window & { __eventCalls: Call[]; __eventUnexpected: string[] };
const eventReference = { kind: "events", namespace: "team-b", name: "warning-one", uid: "event-uid" };
const relatedReference = { kind: "deployments", namespace: "team-b", name: "affected", uid: "deployment-uid" };
const preview = "Scheduling warning <img src=x onerror=alert(1)>";
const fullMessage = `${preview}\n${"Insufficient memory; ".repeat(40)}\n[redacted]`;
const calls = (page: Page, command: string) => page.evaluate(command => (window as FixtureWindow).__eventCalls.filter(call => call.command === command), command);
const table = (page: Page) => page.getByRole("table", { name: "Events", exact: true });
const pane = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });

async function fixture(page: Page) {
  page.on("pageerror", error => { throw error; });
  await page.clock.install({ time: new Date("2026-10-29T12:00:00Z") });
  await page.addInitScript(({ preview, fullMessage }) => {
    const calls: Call[] = [], unexpected: string[] = [];
    const item = (name: string, namespace: string | null, uid: string, columns: Record<string, string> = {}) => ({ name, namespace, uid, resourceVersion: "11", status: "Warning", createdAt: "2026-10-29T10:00:00Z", columns, node: null });
    const event = item("warning-one", "team-b", "event-uid", { message: preview, count: "7", source: "scheduler", involvedObject: "Deployment/affected", lastSeen: "2026-10-29T11:55:00Z", occurrenceTime: "2026-10-29T11:00:00Z", type: "Warning", reason: "FailedScheduling" });
    const missing = item("missing-fields", "team-b", "missing-uid");
    Object.assign(window, { isTauri: true, __eventCalls: calls, __eventUnexpected: unexpected,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, unregisterCallback() {}, invoke: async (command: string, args?: { request?: Request }) => {
        const request = structuredClone(args?.request ?? {}); calls.push({ command, request });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], pinnedItems: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
        if (command === "catalog_connection_states") return [];
        if (command === "preferences_get") return null;
        if (command === "update_state") return { phase: "idle", version: null, error: null };
        if (command === "plugin:event|listen") return 1;
        if (command === "plugin:event|unlisten" || command.endsWith("_cancel") || command === "cluster_disconnect" || command === "row_context_menu_show") return null;
        if (command === "cluster_namespace_cache_get" || command === "cluster_namespace_cache_refresh") return { clusterId: request.clusterId, sessionId: request.sessionId, names: ["team-a", "team-b"], fetchedAt: Date.now(), expiresAt: Date.now() + 60000, partial: false };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: request.clusterId, sessionId: request.sessionId ?? "event-lease", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: "v1.35.8", error: null };
        if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, authorizationEpoch: "event-lease", revision: 1, checkedAt: Date.now(), expiresAt: Date.now() + 30000, items: request.checks.map((check: Request) => ({ check, decision: "allowed", reason: null })) };
        if (command === "cluster_resources") return { ...request, namespace: request.namespace ?? null, items: request.kind === "events" ? [event, missing].filter(row => !request.namespace || row.namespace === request.namespace).filter(row => !request.query || row.columns.message?.includes(request.query)) : request.kind === "namespaces" ? [item("team-b", null, "ns-uid")] : [], continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null };
        if (command === "cluster_resource_detail") {
          const reference = request.reference;
          return { ...request, item: reference.kind === "events" ? event : item("affected", "team-b", "deployment-uid"), related: reference.kind === "events" ? { involvedObject: { kind: "deployments", namespace: "team-b", name: "affected", uid: "deployment-uid" } } : {}, ...(reference.kind === "events" ? { eventDiagnostic: { message: fullMessage, source: "scheduler", fieldPath: null, truncated: true } } : {}) };
        }
        unexpected.push(command); throw "Unexpected synthetic IPC";
      } },
    });
  }, { preview, fullMessage });
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto("/#/cluster/one?section=events");
  await table(page).getByRole("button", { name: "Filter to namespace team-b", exact: true }).first().click();
  await expect.poll(async () => (await calls(page, "cluster_resources")).filter(call => call.request.kind === "events").at(-1)?.request.namespace).toBe("team-b");
  await expect(table(page)).toBeVisible();
}

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as FixtureWindow).__eventUnexpected)).toEqual([]);
  expect((await calls(page, "cluster_resource_delete"))).toEqual([]);
});

test("namespace Events Message opens exact Event with bounded full diagnostic text, not its relation", async ({ page }) => {
  await fixture(page);
  const message = table(page).getByRole("button", { name: preview, exact: true });
  await message.focus();
  await expect(page.getByRole("tooltip")).toContainText("Open full Event diagnostic text (bounded and redacted)");
  await page.keyboard.press("Enter");
  await expect(pane(page).getByText(fullMessage, { exact: true })).toBeVisible();
  await expect(pane(page)).toContainText("Diagnostic text truncated to the display limit.");
  expect((await calls(page, "cluster_resource_detail")).map(call => call.request.reference).at(-1)).toEqual(eventReference);
  expect((await calls(page, "cluster_resource_detail")).some(call => call.request.reference.kind === "deployments")).toBe(false);
  await expect(table(page).locator("img")).toHaveCount(0);
  await expect(pane(page).locator("img")).toHaveCount(0);
});

test("Involved Object resolves Rust detail relationship then navigates to the actual kind", async ({ page }) => {
  await fixture(page);
  await table(page).getByRole("button", { name: "Deployment/affected", exact: true }).click();
  await expect(page).toHaveURL(/section=deployments/);
  await expect(pane(page)).toContainText("affected");
  const refs = (await calls(page, "cluster_resource_detail")).map(call => call.request.reference);
  expect(refs).toContainEqual(eventReference);
  expect(refs.at(-1)).toEqual(relatedReference);
});

test("diagnostic columns preserve source, count, occurrence age and absolute Last Seen; missing stays N/A", async ({ page }) => {
  await fixture(page);
  const headers = await table(page).getByRole("columnheader").allTextContents();
  expect(headers.filter(header => ["Name", "Namespace", "Message", "Count", "Source", "Involved Object", "Last Seen", "Type", "Reason", "Age", "Status"].includes(header))).toEqual(["Name", "Namespace", "Message", "Count", "Source", "Involved Object", "Last Seen", "Type", "Reason", "Age", "Status"]);
  const row = table(page).getByRole("row").filter({ has: page.getByRole("button", { name: "warning-one", exact: true }) });
  const cell = (label: string) => row.getByRole("cell").nth(headers.indexOf(label));
  await expect(cell("Count")).toHaveText("7");
  await expect(cell("Source")).toHaveText("scheduler");
  await expect(cell("Last Seen")).toHaveText("5m");
  await expect(cell("Age")).toHaveText("2h");
  await cell("Last Seen").hover();
  await expect(page.getByRole("tooltip")).toHaveText("2026-10-29T11:55:00Z");
  const missing = table(page).getByRole("row").filter({ has: page.getByRole("button", { name: "missing-fields", exact: true }) });
  for (const label of ["Message", "Count", "Source", "Last Seen", "Involved Object"]) await expect(missing.getByRole("cell").nth(headers.indexOf(label))).toHaveText("N/A");
});

test("checkbox and action menu do not activate Event; message search and namespace use shared filters", async ({ page }) => {
  await fixture(page);
  await table(page).getByRole("checkbox", { name: "Select team-b/warning-one", exact: true }).check();
  await table(page).getByRole("button", { name: "Actions for warning-one", exact: true }).click();
  await expect.poll(async () => (await calls(page, "row_context_menu_show")).length).toBe(1);
  expect(await calls(page, "cluster_resource_detail")).toHaveLength(0);
  await expect(pane(page)).toHaveCount(0);
  await table(page).getByRole("button", { name: "Filter to namespace team-b", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Search Events", exact: true }).fill("Scheduling warning");
  await expect.poll(async () => (await calls(page, "cluster_resources")).filter(call => call.request.kind === "events").at(-1)?.request).toMatchObject({ namespace: "team-b", query: "Scheduling warning" });
  await expect(table(page).getByRole("button", { name: "missing-fields", exact: true })).toHaveCount(0);
});
