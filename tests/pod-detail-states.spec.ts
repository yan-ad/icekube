import { expect, test, type Page } from "@playwright/test";

type Options = { eventsState?: string | null; populated?: boolean; patchOnly?: boolean; updateOnly?: boolean };
type Call = { command: string; request: Record<string, unknown> };
type FixtureWindow = Window & { __detailCalls: Call[]; __patchOnly: boolean };
const inspector = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });

async function fixture(page: Page, options: Options = { eventsState: "complete" }) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(options => {
    const calls: Call[] = [];
    let lease = 0;
    Object.assign(window, {
      isTauri: true, __detailCalls: calls, __patchOnly: options.patchOnly ?? false,
      __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
          const r = { ...args?.request };
          const scope = { clusterId: r.clusterId, sessionId: r.sessionId };
          calls.push({ command, request: r });
          switch (command) {
            case "plugin:event|listen": return 1;
            case "plugin:event|unlisten":
            case "cluster_permissions_cancel":
            case "cluster_resources_cancel":
            case "cluster_disconnect": return null;
            case "cluster_permissions_review": {
              const checks = r.checks as { action: string }[];
              return { ...scope, readId: r.readId, authorizationEpoch: `fixture-${r.sessionId}`, revision: r.readId,
                checkedAt: Date.now(), expiresAt: Date.now() + 1500,
                items: checks.map(check => ({ check, decision: (window as FixtureWindow).__patchOnly && check.action === "update" || options.updateOnly && check.action === "patch" ? "denied" : "allowed", reason: null })) };
            }
            case "catalog_list": return { revision: 1, discoveryError: null, webLinks: [], clusters: [
              { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
            ] };
            case "cluster_session_open":
            case "cluster_connect": return { ...scope, sessionId: r.sessionId ?? `lease-${++lease}`, contextName: "dev",
              status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
            case "cluster_resources": return { ...r, namespace: r.namespace ?? null, continueToken: null, metrics: null, truncated: false, fetchedAt: Date.now(),
              items: r.kind === "namespaces" ? [{ name: "team-a", namespace: null, status: "Active", createdAt: null, node: null, columns: {} }]
                : [{ name: "api-pod", namespace: "team-a", uid: "pod-uid", resourceVersion: "42", status: "Running", createdAt: null, node: null, columns: { ready: "1/1", restarts: "0" } }] };
            case "cluster_pod_detail": return { ...scope, namespace: r.namespace, name: r.name, uid: "pod-uid", resourceVersion: "42",
              phase: "Running", node: "worker-a", podIps: ["10.0.0.8"], hostIps: ["10.0.0.1"], serviceAccount: "default", qos: "Burstable",
              createdAt: "2026-10-01T00:00:00Z", deletionTimestamp: null,
              containers: [{ name: "app", image: "example.test/app:v1", kind: "container", state: "running", ready: true, restarts: 0, ports: [] }],
              conditions: [{ type: "Ready", status: "True" }],
              events: options.populated ? [{ type: "Normal", reason: "Started", count: 1, lastSeen: null }] : [],
              ...(options.eventsState !== undefined ? { eventsState: options.eventsState } : {}),
              yaml: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: api-pod\n  namespace: team-a\n" };
            default: throw new Error(`Unexpected fixture IPC: ${command}`);
          }
        },
      },
    });
  }, options);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/cluster/one?section=pods");
  await page.getByRole("button", { name: "api-pod", exact: true }).click();
  await expect(inspector(page)).toBeVisible();
}

async function noMutations(page: Page) {
  const commands = await page.evaluate(() => (window as FixtureWindow).__detailCalls.map(call => call.command));
  expect(commands.filter(command => /mutate|delete|create|stream_open|forward_start/.test(command))).toEqual([]);
}

for (const state of ["complete", "partial", "denied", "unavailable"] as const) {
  test(`Pod events ${state} preserves facts and reports its actual result`, async ({ page }) => {
    await fixture(page, { eventsState: state });
    await expect(inspector(page).getByRole("term").filter({ hasText: /^UID$/ }).locator("+ dd")).toHaveText("pod-uid");
    if (state === "complete") await expect(inspector(page).getByText("No events returned.", { exact: true })).toBeVisible();
    else {
      const message = { partial: "Event snapshot is incomplete.", denied: "Events access denied.", unavailable: "Events unavailable." }[state];
      await expect(inspector(page).getByRole("status").filter({ hasText: message })).toBeVisible();
      await expect(inspector(page).getByText("No events returned.", { exact: true })).toHaveCount(0);
    }
    await noMutations(page);
  });
}

test("partial events retain returned rows without claiming completeness", async ({ page }) => {
  await fixture(page, { eventsState: "partial", populated: true });
  await expect(inspector(page)).toContainText("Started");
  await expect(inspector(page)).toContainText("Event snapshot is incomplete.");
  await noMutations(page);
});

test("legacy details without eventsState are unavailable, not successful empty events", async ({ page }) => {
  await fixture(page, {});
  await expect(inspector(page)).toContainText("Events unavailable.");
  await expect(inspector(page).getByText("No events returned.", { exact: true })).toHaveCount(0);
  await noMutations(page);
});

for (const eventsState of ["invented", null]) test(`rejects malformed eventsState ${eventsState}`, async ({ page }) => {
  await fixture(page, { eventsState });
  await expect(inspector(page).getByRole("alert")).toContainText("unsupported response");
  await expect(inspector(page).getByRole("heading", { name: "Pod facts", exact: true })).toHaveCount(0);
  await noMutations(page);
});

test("patch-only access cannot edit a PUT-based Pod replacement", async ({ page }) => {
  await fixture(page, { eventsState: "complete", patchOnly: true });
  await expect(inspector(page).getByRole("button", { name: "Edit YAML", exact: true })).toBeDisabled();
  await expect(inspector(page).getByRole("textbox", { name: "YAML", exact: true })).toHaveAttribute("aria-readonly", "true");
  await noMutations(page);
});

test("update access allows review, then patch-only revocation disables Save and editing", async ({ page }) => {
  await fixture(page, { eventsState: "complete", updateOnly: true });
  await inspector(page).getByRole("button", { name: "Edit YAML", exact: true }).click();
  const editor = inspector(page).getByRole("textbox", { name: "YAML", exact: true });
  const save = inspector(page).getByRole("button", { name: "Save YAML", exact: true });
  await expect(editor).toBeEditable();
  await expect(save).toBeEnabled();
  await save.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("This updates the live Pod.");
  await expect(dialog.getByRole("button", { name: "Confirm mutation", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => { (window as FixtureWindow).__patchOnly = true; });
  await expect(save).toBeDisabled();
  await expect(editor).toHaveAttribute("aria-readonly", "true");
  await noMutations(page);
});
