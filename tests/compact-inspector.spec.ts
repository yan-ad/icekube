import { expect, test, type Page } from "@playwright/test";

type Call = { command: string; request: Record<string, unknown> };
type Fixture = Window & { __compactCalls: Call[]; __compactDetailError?: string };
const podName = "api-with-a-long-name-that-must-not-push-the-inspector-controls-offscreen";
const inspector = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });

test("the sole refresh preserves retained Pod details on failure", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { (window as Fixture).__compactDetailError = "resourceUnavailable"; });
  await inspector(page).getByRole("button", { name: "Refresh details", exact: true }).click();
  await expect(inspector(page).getByRole("alert")).toContainText("Retained details may be stale");
  await expect(inspector(page).getByRole("heading", { name: "Containers", exact: true })).toBeVisible();
  await expect(inspector(page).getByRole("button", { name: "Refresh details", exact: true })).toBeEnabled();
});
const calls = (page: Page, command: string) => page.evaluate(command => (window as Fixture).__compactCalls.filter(call => call.command === command), command);

async function fixture(page: Page) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(name => {
    const calls: Call[] = [];
    Object.assign(window, { isTauri: true, __compactCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
        const request = structuredClone(args?.request ?? {}); calls.push({ command, request });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: "one", sessionId: "compact-lease", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        if (["cluster_disconnect", "cluster_resources_cancel", "cluster_pod_mutate", "cluster_pod_stream_close", "cluster_pod_stream_resize", "cluster_pod_stream_write"].includes(command)) return null;
        if (command === "cluster_resources") return { ...request, namespace: request.namespace ?? null, items: request.kind === "pods" ? [{ name, namespace: "team-a", uid: "compact-uid", resourceVersion: "list-version", createdAt: null, status: "Running", columns: { health: "healthy", ready: "1/1", restarts: "0" }, node: null }] : [], continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null };
        if (command === "cluster_pod_detail") {
          if ((window as Fixture).__compactDetailError) throw (window as Fixture).__compactDetailError;
          return { ...request, uid: "compact-uid", resourceVersion: "detail-version", phase: "Running", node: null, podIps: [], hostIps: [], serviceAccount: null, qos: null, createdAt: null, deletionTimestamp: null, conditions: [], events: [],
          containers: Array.from({ length: 12 }, (_, index) => ({ name: `container-${index}`, image: "example/image:v1", kind: "container", state: "running", ready: true, restarts: 0, ports: [{ name: null, port: 8080, protocol: "TCP" }] })), yaml: `apiVersion: v1\nkind: Pod\nmetadata:\n  name: ${name}\n` };
        }
        if (command === "cluster_pod_forward_list") return [];
        if (command === "cluster_pod_stream_open" || command === "cluster_pod_stream_read") return { clusterId: "one", sessionId: "compact-lease", streamId: "compact-stream", sequence: 0, output: "", status: "exited", error: null, truncated: false };
        throw `Unexpected compact inspector fixture command: ${command}`;
      },
    } });
  }, podName);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/cluster/one?section=pods");
  await page.getByRole("table", { name: "Pods", exact: true }).getByRole("button", { name: podName, exact: true }).click();
  await expect(inspector(page).getByRole("heading", { name: "Containers", exact: true })).toBeVisible();
}

test("one compact title and refresh remain fixed while Pod facts scroll to YAML", async ({ page }) => {
  await fixture(page);
  const panel = inspector(page), header = panel.locator(".resource-inspector-header");
  const title = header.getByRole("heading", { name: podName, exact: true });
  await expect.poll(() => title.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.waitForTimeout(250);
  await page.mouse.move(0, 0);
  await title.hover();
  await expect(page.getByRole("tooltip")).toContainText(podName);
  await page.mouse.move(0, 0);
  await expect(panel.getByRole("heading", { name: podName, exact: true })).toHaveCount(1);
  await expect(panel.getByText(`team-a/${podName}`, { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /Refresh details|Reload details/ })).toHaveCount(1);
  for (const name of ["Logs", "Shell", "Attach", "Port forward"]) await expect(header.getByRole("button", { name, exact: true })).toBeEnabled();
  expect(await title.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  const initial = (await header.boundingBox())!;
  const scroll = panel.locator(".resource-inspector-body");
  expect(await scroll.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(panel.getByRole("button", { name: "Edit YAML", exact: true })).toBeInViewport();
  expect((await header.boundingBox())!.y).toBe(initial.y);
  const beforeRefresh = (await calls(page, "cluster_pod_detail")).length;
  await header.getByRole("button", { name: "Refresh details", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_pod_detail")).length).toBeGreaterThan(beforeRefresh);
});

test("embedded YAML editing preserves confirmed mutation identity and keyboard dismissal", async ({ page }) => {
  await fixture(page);
  const edit = inspector(page).getByRole("button", { name: "Edit YAML", exact: true });
  await edit.scrollIntoViewIfNeeded(); await edit.focus(); await edit.press("Enter");
  const save = inspector(page).getByRole("button", { name: "Save YAML", exact: true });
  await save.scrollIntoViewIfNeeded(); await save.focus(); await save.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("compact-uid");
  expect(await calls(page, "cluster_pod_mutate")).toHaveLength(0);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await expect(inspector(page)).toBeVisible();
  await save.click(); await dialog.getByRole("button", { name: "Confirm mutation", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_pod_mutate")).length).toBe(1);
  expect((await calls(page, "cluster_pod_mutate"))[0].request).toMatchObject({ clusterId: "one", sessionId: "compact-lease", namespace: "team-a", name: podName, uid: "compact-uid", resourceVersion: "detail-version", action: "replace" });
});

for (const [label, mode] of [["Logs", "logs"], ["Shell", "shell"], ["Attach", "attach"], ["Port forward", "forward"]]) test(`header ${label} opens the UID-scoped dock`, async ({ page }) => {
  await fixture(page);
  await inspector(page).locator(".resource-inspector-header").getByRole("button", { name: label, exact: true }).click();
  await expect(inspector(page)).toHaveCount(0);
  await expect(page.getByRole("tab", { name: `${podName} · ${mode}`, exact: true })).toBeVisible();
  expect((await calls(page, "cluster_pod_detail")).at(-1)!.request).toEqual({ clusterId: "one", sessionId: "compact-lease", namespace: "team-a", name: podName, uid: "compact-uid" });
});

test("narrow inset inspector wraps actions without clipping and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await fixture(page);
  await page.setViewportSize({ width: 390, height: 760 });
  const panel = inspector(page);
  await expect(panel).toBeVisible();
  const bounds = (await panel.boundingBox())!;
  for (const name of ["Logs", "Shell", "Attach", "Port forward", "Refresh details", "Expand inspector", "Close inspector"]) {
    const button = panel.getByRole("button", { name, exact: true }), box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1); expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await panel.evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
  await panel.locator(".resource-inspector-body").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(panel.getByRole("button", { name: "Edit YAML", exact: true })).toBeInViewport();
});

for (const shortcut of ["Meta+r", "Control+r"]) test(`focused inspector ${shortcut} refreshes details, not the resource list`, async ({ page }) => {
  await fixture(page);
  const panel = inspector(page);
  await expect(panel.getByRole("button", { name: "Refresh details", exact: true })).toBeEnabled();
  const detailReads = (await calls(page, "cluster_pod_detail")).length;
  const listReads = (await calls(page, "cluster_resources")).length;
  await panel.focus();
  await page.keyboard.press(shortcut);
  await expect.poll(async () => (await calls(page, "cluster_pod_detail")).length).toBe(detailReads + 1);
  await expect(panel.getByRole("button", { name: "Refresh details", exact: true })).toBeEnabled();
  expect((await calls(page, "cluster_resources")).length).toBe(listReads);
});
