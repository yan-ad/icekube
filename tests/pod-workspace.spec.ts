import { expect, test, type Page } from "@playwright/test";

type Request = Record<string, string | number | boolean | null>;
type Call = { command: string; request: Request };
type Controls = {
  podName?: string;
  holdStreams?: boolean;
  holdSync?: boolean;
  holdSyncReads?: boolean;
  syncOpening?: boolean;
  syncOpenError?: string;
  detailError?: string;
  mutateError?: string;
  malformedDetails?: boolean;
  malformedStream?: boolean;
  malformedForward?: "localPort" | "status";
  syncError?: string;
  syncStatus?: "syncing" | "retrying" | "error" | "stopped";
  syncPodStatus?: string;
  chunks?: string[];
  streamReadError?: string;
  noRunningContainers?: boolean;
  streamStatus?: "running" | "exited" | "error";
};
type MockWindow = Window & {
  __podCalls: Call[];
  __podControl: Controls;
  __releasePodStreams: () => void;
  __releasePodSync: () => void;
  __releasePodSyncReads: () => void;
  __selectPodRowAction: (action: string) => void;
};
const route = (section: string) => `/cluster/one?section=${section}`;
const inspector = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });
const fact = (page: Page, label: string) => inspector(page).getByRole("term").filter({ hasText: new RegExp(`^${label}$`) }).locator("+ dd");
const mutationDialog = (page: Page) => page.getByRole("dialog");
const dock = (page: Page) => page.getByRole("complementary", { name: "Pod dock", exact: true });

test("live sync keeps an open actions menu usable across polling and repeated toggles", async ({ page }) => {
  await fixture(page);
  for (let cycle = 0; cycle < 3; cycle++) {
    await clusterAction(page, "Enable live sync");
    await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Refresh pods", exact: true })).toHaveCount(0);
    const pause = page.getByRole("menuitem", { name: "Pause live sync", exact: true });
    await expect(pause).toBeEnabled();
    await page.mouse.move(0, 0);
    await pause.focus();
    const reads = (await calls(page, "cluster_pod_sync_read")).length;
    await expect.poll(async () => (await calls(page, "cluster_pod_sync_read")).length).toBeGreaterThan(reads + 1);
    await expect(pause).toBeFocused();
    await expect(row(page)).toContainText("Succeeded");
    await pause.press("Enter");
    await expect(row(page)).toContainText("Running");
    const stoppedReads = (await calls(page, "cluster_pod_sync_read")).length;
    await page.waitForTimeout(600);
    expect(await calls(page, "cluster_pod_sync_read")).toHaveLength(stoppedReads);
  }
});

test("live sync serializes reads and ignores a read resolved after pause", async ({ page }) => {
  await fixture(page, { holdSyncReads: true });
  await clusterAction(page, "Enable live sync");
  await expect.poll(async () => (await calls(page, "cluster_pod_sync_read")).length).toBe(1);
  await page.waitForTimeout(1100);
  expect(await calls(page, "cluster_pod_sync_read")).toHaveLength(1);
  await clusterAction(page, "Pause live sync");
  await expect(row(page)).toContainText("Running");
  await page.evaluate(() => (window as MockWindow).__releasePodSyncReads());
  await page.waitForTimeout(600);
  expect(await calls(page, "cluster_pod_sync_read")).toHaveLength(1);
  await expect(row(page)).not.toContainText("Succeeded");
  await expect.poll(async () => (await calls(page, "cluster_pod_sync_close")).length).toBe(1);
});

for (const status of ["exited", "error"] as const) test(`drains ${status} stream chunks before the final empty read and downloads the full fixture`, async ({ page }) => {
  const chunks = ["a".repeat(65536), "b".repeat(65536), "final marker\n", ""];
  await fixture(page, { chunks, streamStatus: status }); await openLogs(page);
  const output = dock(page).getByLabel("Pod logs", { exact: true });
  await expect(output).toContainText("final marker");
  await expect(dock(page).getByRole("status").filter({ hasText: new RegExp(`^${status}$`) })).toBeVisible();
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_read")).length).toBe(4);
  await page.waitForTimeout(600);
  expect(await calls(page, "cluster_pod_stream_read")).toHaveLength(4);
  const download = page.waitForEvent("download");
  await dock(page).getByRole("button", { name: "Download output", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download buffered", exact: true }).click();
  const file = await (await download).createReadStream(); const parts: Buffer[] = [];
  for await (const part of file!) parts.push(part);
  const value = Buffer.concat(parts).toString();
  expect(value).toContain("final marker");
  expect(value).toContain("a".repeat(65536));
  expect(value).toContain("b".repeat(65536));
  const visibleDownload = page.waitForEvent("download");
  await dock(page).getByRole("button", { name: "Download output", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download visible snapshot", exact: true }).click();
  const visibleFile = await (await visibleDownload).createReadStream(); const visibleParts: Buffer[] = [];
  for await (const part of visibleFile!) visibleParts.push(part);
  expect(Buffer.concat(visibleParts).toString()).toBe(value);
});

for (const malformedForward of ["localPort", "status"] as const) test(`best effort stops malformed port forward ${malformedForward} responses`, async ({ page }) => {
  await fixture(page, { malformedForward }); await action(page, "Port forward");
  await dock(page).getByRole("button", { name: "Start forward", exact: true }).click();
  await expect(dock(page).getByRole("alert")).toContainText("unsupported response");
  await expect.poll(async () => (await calls(page, "cluster_pod_forward_stop")).map(c => c.request.id)).toEqual(["forward-1"]);
  const started = (await calls(page, "cluster_pod_forward_start"))[0].request;
  expect((await calls(page, "cluster_pod_forward_stop"))[0].request).toEqual({ clusterId: started.clusterId, sessionId: started.sessionId, id: "forward-1" });
});

test("bounds large terminal paste before chunking", async ({ page }) => {
  await fixture(page); await action(page, "Shell");
  const input = dock(page).locator(".xterm-helper-textarea"); await expect(input).toHaveCount(1);
  await input.focus();
  await page.evaluate(() => {
    const node = document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!;
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "😀éx".repeat(200000));
    node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData }));
  });
  await expect(dock(page).getByRole("alert")).toContainText("input queue is full");
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_write")).length).toBe(4);
  const writes = await calls(page, "cluster_pod_stream_write");
  const data = writes.map(c => String(c.request.data)).join("");
  expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(65536);
  expect(new TextEncoder().encode(data).length).toBeGreaterThan(65530);
  expect(data).not.toContain("�");
  for (const write of writes) expect(new TextEncoder().encode(String(write.request.data)).length).toBeLessThanOrEqual(16384);
});
const grid = (page: Page, name = "Pods") => page.getByRole("table", { name, exact: true });
const row = (page: Page, name = "api-pod") => grid(page).getByRole("row").filter({ has: page.getByRole("button", { name, exact: true }) });
const calls = (page: Page, command: string) => page.evaluate(command =>
  (window as MockWindow).__podCalls.filter(call => call.command === command), command);
async function control(page: Page, value: Controls) {
  await page.evaluate(value => Object.assign((window as MockWindow).__podControl, value), value);
}
async function navigate(page: Page, section: string) {
  await page.evaluate(hash => { location.hash = hash; }, route(section));
}
async function action(page: Page, label: string, name = "api-pod") {
  const before = (await calls(page, "row_context_menu_show")).length;
  await row(page, name).getByRole("button", { name: `Actions for ${name}`, exact: true }).click();
  const actions: Record<string, string> = { Details: "details", "Edit YAML": "edit", Logs: "logs", Shell: "shell", Attach: "attach", "Port forward": "forward" };
  await expect.poll(async () => (await calls(page, "row_context_menu_show")).length).toBe(before + 1);
  await page.evaluate(action => (window as MockWindow).__selectPodRowAction(action), actions[label]);
}
async function openLogs(page: Page) {
  await action(page, "Logs");
  await expect(dock(page).getByLabel("Pod logs", { exact: true })).toContainText("boot ready");
}
async function fixture(page: Page, options: Controls = {}) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(options => {
    const calls: Call[] = [];
    const control: Controls = { chunks: [], ...options };
    let lease = 0, streamId = 0, syncId = 0, forwardId = 0;
    const streams = new Map<string, { request: Request; sequence: number }>();
    const syncs = new Map<string, { request: Request; sequence: number }>();
    const forwards = new Map<string, Request>();
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, number>();
    let callbackId = 0;
    let menuRequest: { clusterId: string; sessionId: string; requestId: string; actions: string[] } | null = null;
    const streamWaiters: (() => void)[] = [], syncWaiters: (() => void)[] = [], syncReadWaiters: (() => void)[] = [];
    const scope = (r: Request) => ({ clusterId: r.clusterId, sessionId: r.sessionId });
    const resourcePage = (r: Request, status = "Running") => ({
      ...r, namespace: r.namespace ?? null, continueToken: null, metrics: null,
      truncated: false, fetchedAt: 1793000000000,
      items: r.kind === "namespaces" ? ["team-a", "team-b", "production", "default"].map(name => ({
        name, namespace: null, status: "Active", createdAt: null, node: null, columns: {},
      })) : [{ name: r.kind === "pods" ? control.podName ?? "api-pod" : "api-service", namespace: r.namespace ?? "team-a",
        uid: r.kind === "pods" ? "pod-uid-123" : "service-uid-123", resourceVersion: "42",
        status, createdAt: "2026-10-01T00:00:00Z", node: null,
        columns: { ready: "1/1", restarts: "2", node: "worker-a", qos: "Burstable" } }],
    });
    const streamSnapshot = (r: Request, id: string, sequence: number, output: string) => ({
      ...scope(r), streamId: id, sequence, output, status: control.streamStatus ?? "running",
      error: control.streamStatus === "error" ? "processUnavailable" : null, truncated: false,
    });
    Object.assign(window, {
      isTauri: true, __podCalls: calls, __podControl: control,
      __selectPodRowAction: (action: string) => {
        if (!menuRequest?.actions.includes(action)) throw new Error(`Unavailable row action: ${action}`);
        const payload = { clusterId: menuRequest.clusterId, sessionId: menuRequest.sessionId, requestId: menuRequest.requestId, action };
        for (const [id, handler] of [...listeners]) callbacks.get(handler)?.({ event: "icekube://row-context-menu", id, payload });
        menuRequest = null;
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => listeners.delete(id) },
      __releasePodStreams: () => { control.holdStreams = false; streamWaiters.splice(0).forEach(resolve => resolve()); },
      __releasePodSync: () => { control.holdSync = false; syncWaiters.splice(0).forEach(resolve => resolve()); },
      __releasePodSyncReads: () => { control.holdSyncReads = false; syncReadWaiters.splice(0).forEach(resolve => resolve()); },
      __TAURI_INTERNALS__: {
        transformCallback: (callback: (event: unknown) => void) => { const id = ++callbackId; callbacks.set(id, callback); return id; },
        invoke: async (command: string, args?: { request: Request; handler?: number; eventId?: number }) => {
          const r = { ...args?.request };
          calls.push({ command, request: r });
          switch (command) {
            case "plugin:event|listen": { const id = ++callbackId; listeners.set(id, args!.handler!); return id; }
            case "plugin:event|unlisten": listeners.delete(args!.eventId!); return null;
            case "row_context_menu_show": menuRequest = args!.request as unknown as NonNullable<typeof menuRequest>; return null;
            case "row_context_menu_cancel": return null;
            case "catalog_list": return { revision: 1, discoveryError: null, webLinks: [], clusters: [
              { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [],
                color: "#476BA1", pinned: false, status: "disconnected" },
            ] };
            case "cluster_session_open":
            case "cluster_connect": return { ...scope(r), sessionId: r.sessionId ?? `lease-${++lease}`, contextName: "dev",
              status: command === "cluster_connect" ? "connected" : "disconnected",
              apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
            case "cluster_disconnect":
            case "cluster_resources_cancel": return null;
            case "cluster_resources": return resourcePage(r);
            case "cluster_pod_detail": {
              if (control.detailError) throw control.detailError;
              return { ...scope(r), namespace: r.namespace, name: r.name, uid: control.malformedDetails ? "wrong-uid" : "pod-uid-123",
                resourceVersion: "42", phase: "Running", node: "worker-a", podIps: ["10.0.0.8"], hostIps: ["10.0.0.1"],
                serviceAccount: "default", qos: "Burstable", createdAt: "2026-10-01T00:00:00Z", deletionTimestamp: "2026-10-26T00:00:00Z",
                containers: [
                  { name: "app", image: "example.test/app:v1", kind: "container", state: control.noRunningContainers ? "waiting" : "running", ready: true, restarts: 2,
                    ports: [{ name: "http", port: 8080, protocol: "TCP" }] },
                  { name: "setup", image: "example.test/setup:v1", kind: "init", state: "terminated", ready: false, restarts: 1, ports: [] },
                ], conditions: [{ type: "Ready", status: "True" }],
                events: [{ type: "Normal", reason: "Started", count: 2, lastSeen: "2026-10-26T00:00:00Z" }],
                yaml: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: api-pod\n  namespace: team-a\n  uid: pod-uid-123\n  resourceVersion: '42'\nspec:\n  containers: []\n" };
            }
            case "cluster_pod_mutate": if (control.mutateError) throw control.mutateError; return null;
            case "cluster_pod_stream_open": {
              const id = `stream-${++streamId}`;
              streams.set(id, { request: r, sequence: 0 });
              if (control.holdStreams) await new Promise<void>(resolve => streamWaiters.push(resolve));
              return { ...streamSnapshot(r, id, 0, "boot ready\nready again\n"), ...(control.malformedStream ? { sequence: -1 } : {}) };
            }
            case "cluster_pod_stream_read": {
              if (control.streamReadError) throw control.streamReadError;
              const s = streams.get(String(r.streamId));
              if (!s) throw "staleSession";
              return streamSnapshot(s.request, String(r.streamId), ++s.sequence, control.chunks?.shift() ?? "");
            }
            case "cluster_pod_stream_close": streams.delete(String(r.streamId)); return null;
            case "cluster_pod_stream_write":
            case "cluster_pod_stream_resize": return null;
            case "cluster_pod_forward_start": {
              const id = `forward-${++forwardId}`;
              const f = { ...scope(r), id, namespace: r.namespace, name: r.name, remotePort: r.remotePort,
                localPort: r.localPort || 43210, status: "running", error: null };
              forwards.set(id, f);
              return { ...f, ...(control.malformedForward === "localPort" ? { localPort: -1 } : control.malformedForward === "status" ? { status: "invalid" } : {}) };
            }
            case "cluster_pod_forward_list": return [...forwards.values()];
            case "cluster_pod_forward_stop": forwards.delete(String(r.id)); return null;
            case "cluster_pod_sync_open": {
              if (control.syncOpenError) throw control.syncOpenError;
              const id = `sync-${++syncId}`;
              syncs.set(id, { request: r, sequence: 0 });
              if (control.holdSync) await new Promise<void>(resolve => syncWaiters.push(resolve));
              return { ...scope(r), syncId: id, sequence: 0, page: control.syncOpening ? null : resourcePage(r), status: control.syncOpening ? "opening" : "syncing", error: null };
            }
            case "cluster_pod_sync_read": {
              const s = syncs.get(String(r.syncId));
              if (!s) throw "staleSession";
              if (control.holdSyncReads) await new Promise<void>(resolve => syncReadWaiters.push(resolve));
              return { ...scope(r), syncId: r.syncId, sequence: ++s.sequence,
                page: control.syncError ? null : resourcePage(s.request, control.syncPodStatus ?? "Succeeded"),
                status: control.syncStatus ?? (control.syncError ? "error" : "syncing"), error: control.syncError ?? null };
            }
            case "cluster_pod_sync_close": syncs.delete(String(r.syncId)); return null;
            default: throw new Error(`Unexpected mock IPC: ${command}`);
          }
        },
      },
    });
  }, options);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/#${route("pods")}`);
  await expect(row(page, options.podName)).toBeVisible();
}

async function allStreamsClosed(page: Page) {
  await expect.poll(async () => {
    const opened = await calls(page, "cluster_pod_stream_open");
    const closed = await calls(page, "cluster_pod_stream_close");
    return opened.every((_, i) => closed.some(c => c.request.streamId === `stream-${i + 1}`));
  }).toBe(true);
}

test("Pod name and Details reuse the sidebar; stream actions open only bottom dock tabs", async ({ page }) => {
  await fixture(page);
  await row(page).getByRole("button", { name: "api-pod", exact: true }).click();
  await expect(inspector(page).getByRole("heading", { name: "api-pod", exact: true })).toBeVisible();
  await expect(inspector(page).getByRole("heading", { name: "Pods: api-pod", exact: true })).toHaveCount(0);
  await expect(inspector(page).getByRole("button", { name: "Refresh details", exact: true })).toHaveCount(1);
  for (const [label, value] of [["Namespace", "team-a"], ["UID", "pod-uid-123"], ["Resource version", "42"], ["Node", "worker-a"], ["Pod IPs", "10.0.0.8"], ["Host IPs", "10.0.0.1"], ["Service account", "default"], ["QoS", "Burstable"], ["Created", "2026-10-01T00:00:00Z"], ["Reason", "Started"], ["Type", "Normal"], ["Count", "2"]]) {
    await expect(fact(page, label)).toHaveText(value);
  }
  await expect(fact(page, "Age")).toHaveText(/^\d+[smhd]$/);
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  await row(page).getByRole("button", { name: "api-pod", exact: true }).press("Enter");
  await expect(inspector(page)).toBeVisible();
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  await action(page, "Details");
  await expect(inspector(page)).toHaveCount(1);
  await expect(dock(page)).toHaveCount(0);
  await expect(inspector(page).getByRole("textbox", { name: "YAML", exact: true })).toHaveAttribute("aria-readonly", "true");
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  await action(page, "Edit YAML");
  await expect(inspector(page).getByRole("textbox", { name: "YAML", exact: true })).toBeEditable();
  await expect(dock(page)).toHaveCount(0);
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  for (const [label, mode] of [["Logs", "logs"], ["Shell", "shell"], ["Attach", "attach"], ["Port forward", "forward"]]) {
    await action(page, label);
    await expect(dock(page).getByRole("tab", { name: `api-pod · ${mode}`, exact: true })).toHaveAttribute("aria-selected", "true");
  }
  await expect(dock(page).getByRole("tab")).toHaveCount(4);
  for (const c of await calls(page, "cluster_pod_detail")) expect(c.request).toMatchObject({ clusterId: "one", namespace: "team-a", name: "api-pod" });
  await navigate(page, "services");
  await expect(grid(page, "Services")).toContainText("api-service");
  await expect(dock(page).getByRole("tab")).toHaveCount(4);
  await expect(dock(page).getByRole("button", { name: "Start forward", exact: true })).toBeVisible();
  await navigate(page, "pods");
  await expect(row(page)).toBeVisible();
  await expect(dock(page).getByRole("tab")).toHaveCount(4);
});

test("dock minimizes, maximizes, resizes, and provides keyboard tab selection and close", async ({ page }) => {
  await fixture(page); await openLogs(page); await action(page, "Shell");
  const separator = dock(page).getByRole("separator", { name: "Resize Pod dock" });
  await separator.focus(); await separator.press("ArrowUp");
  await expect(separator).toHaveAttribute("aria-valuenow", "45");
  await separator.press("Home"); await expect(separator).toHaveAttribute("aria-valuenow", "20");
  await separator.press("End"); await expect(separator).toHaveAttribute("aria-valuenow", "80");
  await dock(page).getByRole("button", { name: "Maximize dock", exact: true }).click();
  await expect(dock(page).getByRole("button", { name: "Restore dock", exact: true })).toBeVisible();
  await dock(page).getByRole("button", { name: "Restore dock", exact: true }).click();
  const shell = dock(page).getByRole("tab", { name: "api-pod · shell", exact: true });
  const logs = dock(page).getByRole("tab", { name: "api-pod · logs", exact: true });
  await shell.focus(); await shell.press("ArrowLeft"); await expect(logs).toBeFocused();
  await logs.press("End"); await expect(shell).toBeFocused();
  await shell.press("Home"); await expect(logs).toBeFocused();
  await logs.press("Shift+Escape");
  await expect(dock(page).getByLabel("Pod logs", { exact: true })).toBeHidden();
  await dock(page).getByRole("button", { name: "Show dock", exact: true }).click();
  await expect(dock(page).getByLabel("Pod logs", { exact: true })).toBeVisible();
  await dock(page).getByRole("button", { name: "Minimize dock", exact: true }).click();
  await logs.click(); await expect(dock(page).getByLabel("Pod logs", { exact: true })).toBeVisible();
  await logs.press("Control+w"); await expect(logs).toHaveCount(0);
  await shell.focus(); await shell.press("Control+w"); await expect(dock(page)).toHaveCount(0);
  await allStreamsClosed(page);
});

test("Pod dock is footer anchored and tab actions close right, other, all, and middle-clicked tabs", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 1200, height: 800 });

  await action(page, "Port forward");
  await openLogs(page);
  await action(page, "Shell");
  await expect(dock(page).getByRole("tab")).toHaveCount(3);
  await expect(dock(page).locator(".xterm-helper-textarea")).toHaveCount(1);

  const geometry = await page.evaluate(() => {
    const footer = document.querySelector<HTMLElement>('[aria-label="Pod dock"]');
    return { bottom: footer?.getBoundingClientRect().bottom ?? -1, height: window.innerHeight, scrollHeight: document.documentElement.scrollHeight };
  });
  expect(Math.abs(geometry.bottom - geometry.height)).toBeLessThanOrEqual(4);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.height);

  const logs = dock(page).getByRole("tab", { name: "api-pod · logs", exact: true });
  const forward = dock(page).getByRole("tab", { name: "api-pod · forward", exact: true });
  await forward.click();
  await dock(page).getByRole("button", { name: "Tab actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Close tabs to the right", exact: true }).click();
  await expect(dock(page).getByRole("tab")).toHaveCount(1);
  await expect(forward).toHaveAttribute("aria-selected", "true");
  await allStreamsClosed(page);

  await openLogs(page);
  await action(page, "Shell");
  await expect(dock(page).locator(".xterm-helper-textarea")).toHaveCount(1);
  await expect(dock(page).getByRole("tab")).toHaveCount(3);
  await forward.click();
  await dock(page).getByRole("button", { name: "Tab actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Close other tabs", exact: true }).click();
  await expect(dock(page).getByRole("tab")).toHaveCount(1);
  await expect(forward).toHaveAttribute("aria-selected", "true");
  await allStreamsClosed(page);

  await openLogs(page);
  await action(page, "Shell");
  await expect(dock(page).locator(".xterm-helper-textarea")).toHaveCount(1);
  await expect(dock(page).getByRole("tab")).toHaveCount(3);
  await logs.dispatchEvent("auxclick", { button: 1 });
  await expect(dock(page).getByRole("tab")).toHaveCount(2);
  await expect(logs).toHaveCount(0);

  const streamsOpenedBeforeAllClose = (await calls(page, "cluster_pod_stream_open")).length;
  await dock(page).getByRole("button", { name: "Tab actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Close all tabs", exact: true }).click();
  await expect(dock(page)).toHaveCount(0);
  await allStreamsClosed(page);
  await page.waitForTimeout(600);
  expect((await calls(page, "cluster_pod_stream_open")).length).toBe(streamsOpenedBeforeAllClose);
});

test("StrictMode discarded opens and streams that resolve after tab close are cleaned up", async ({ page }) => {
  await fixture(page, { holdStreams: true }); await action(page, "Logs");
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).length).toBeGreaterThanOrEqual(2);
  await dock(page).getByRole("button", { name: "Close api-pod logs", exact: true }).click();
  await page.evaluate(() => (window as MockWindow).__releasePodStreams());
  await allStreamsClosed(page);
  await expect(dock(page)).toHaveCount(0);
  expect(await calls(page, "cluster_pod_stream_read")).toHaveLength(0);
});

for (const colorScheme of ["light", "dark"] as const) test(`logs keep a black readable surface and keyboard switches in ${colorScheme} mode`, async ({ page }) => {
  await page.emulateMedia({ colorScheme });
  await fixture(page); await openLogs(page);
  await dock(page).getByRole("button", { name: "Maximize dock", exact: true }).click();
  const output = dock(page).getByLabel("Pod logs", { exact: true });
  await expect(output).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(output).toHaveCSS("color", "rgb(245, 245, 245)");
  const previous = dock(page).getByRole("switch", { name: "Previous", exact: true });
  const timestamps = dock(page).getByRole("switch", { name: "Timestamps", exact: true });
  await expect(previous).not.toBeChecked();
  await expect(timestamps).toBeChecked();
  await previous.focus(); await expect(previous).toBeFocused(); await previous.press("Space");
  await expect(previous).toBeChecked();
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).at(-1)!.request.previous).toBe(true);
  await timestamps.focus(); await expect(timestamps).toBeFocused(); await timestamps.press("Space");
  await expect(timestamps).not.toBeChecked();
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).at(-1)!.request.timestamps).toBe(false);
  await dock(page).getByRole("textbox", { name: "Search buffered logs", exact: true }).fill("ready");
  const highlight = output.locator("mark");
  await expect(highlight).toHaveText(/ready/i);
  await expect(highlight).toHaveCSS("background-color", "rgb(250, 204, 21)");
  await expect(highlight).toHaveCSS("color", "rgb(0, 0, 0)");
  await page.emulateMedia({ colorScheme: colorScheme === "light" ? "dark" : "light" });
  await expect(output).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(output).toHaveCSS("color", "rgb(245, 245, 245)");
  await expect(highlight).toHaveCSS("background-color", "rgb(250, 204, 21)");
  await expect(highlight).toHaveCSS("color", "rgb(0, 0, 0)");
  await dock(page).getByRole("button", { name: "Clear", exact: true }).click();
  await expect(output).toHaveText("Waiting for output…");
  await expect(output).toHaveCSS("background-color", "rgb(0, 0, 0)");
});

test("logs restart for init/regular container and previous/timestamps; search, pause, wrap and downloads use buffered chunks", async ({ page }) => {
  await fixture(page); await openLogs(page);
  expect((await calls(page, "cluster_pod_stream_open")).at(-1)!.request).toMatchObject({
    clusterId: "one", namespace: "team-a", name: "api-pod", uid: "pod-uid-123", container: "app", mode: "logs",
    previous: false, timestamps: true, tailLines: 500, shell: null,
  });
  await dock(page).getByRole("button", { name: "Maximize dock", exact: true }).click();
  await dock(page).getByRole("combobox", { name: "Container", exact: true }).click();
  await page.getByRole("option", { name: "setup (init)", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).at(-1)!.request.container).toBe("setup");
  await dock(page).getByRole("switch", { name: "Previous", exact: true }).check();
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).at(-1)!.request.previous).toBe(true);
  await dock(page).getByRole("switch", { name: "Timestamps", exact: true }).uncheck();
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).at(-1)!.request.timestamps).toBe(false);
  await dock(page).getByRole("combobox", { name: "Container", exact: true }).click();
  await page.getByRole("option", { name: "app (container)", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).at(-1)!.request.container).toBe("app");
  const output = dock(page).getByLabel("Pod logs", { exact: true });
  await expect(output).toContainText("boot ready");
  const search = dock(page).getByRole("textbox", { name: "Search buffered logs", exact: true });
  await output.focus(); await output.press("Control+f"); await expect(search).toBeFocused();
  await search.fill("READY");
  await search.press("Enter");
  await expect(dock(page).getByText("2/2 matches", { exact: true })).toBeVisible();
  await search.press("Shift+Enter");
  await expect(dock(page).getByText("1/2 matches", { exact: true })).toBeVisible();
  await output.focus(); await output.press("Meta+f"); await expect(search).toBeFocused();
  await expect(dock(page).getByText("1/2 matches", { exact: true })).toBeVisible();
  await dock(page).getByRole("button", { name: "Next match", exact: true }).click();
  await expect(dock(page).getByText("2/2 matches", { exact: true })).toBeVisible();
  await dock(page).getByRole("button", { name: "Previous match", exact: true }).click();
  await expect(dock(page).getByText("1/2 matches", { exact: true })).toBeVisible();
  await dock(page).getByRole("textbox", { name: "Search buffered logs", exact: true }).fill("");
  await dock(page).getByRole("button", { name: "No wrap", exact: true }).click();
  await expect(output).toHaveCSS("white-space", "pre");
  await dock(page).getByRole("button", { name: "Wrap lines", exact: true }).click();
  await expect(output).toHaveCSS("white-space", "pre-wrap");
  await dock(page).getByRole("button", { name: "Pause follow", exact: true }).click();
  await control(page, { chunks: ["arrived while paused\n"] });
  await expect.poll(() => page.evaluate(() => (window as MockWindow).__podControl.chunks?.length)).toBe(0);
  await expect(output).not.toContainText("arrived while paused");
  const bufferedDownload = page.waitForEvent("download");
  await dock(page).getByRole("button", { name: "Download output", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download buffered", exact: true }).click();
  const buffered = await bufferedDownload;
  expect(buffered.suggestedFilename()).toBe("pod-buffered.log");
  const stream = await buffered.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toContain("arrived while paused");
  const visibleDownload = page.waitForEvent("download");
  await dock(page).getByRole("button", { name: "Download output", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download visible snapshot", exact: true }).click();
  const visible = await visibleDownload;
  const visibleStream = await visible.createReadStream();
  const visibleChunks: Buffer[] = []; for await (const chunk of visibleStream!) visibleChunks.push(chunk);
  expect(Buffer.concat(visibleChunks).toString()).not.toContain("arrived while paused");
  await dock(page).getByRole("button", { name: "Resume follow", exact: true }).click();
  await expect(output).toContainText("arrived while paused");
  await control(page, { chunks: ["process finished\n"], streamStatus: "exited" });
  await expect(output).toContainText("process finished");
  await expect(dock(page).getByRole("status").filter({ hasText: /^exited$/ })).toBeVisible();
  await dock(page).getByRole("button", { name: "Clear", exact: true }).click();
  await expect(output).toHaveText("Waiting for output…");
  await dock(page).getByRole("button", { name: "Close api-pod logs", exact: true }).click();
  await allStreamsClosed(page);
});

test("shell and attach use xterm write/resize and dispose on disconnect", async ({ page }) => {
  await fixture(page); await action(page, "Shell");
  await dock(page).getByRole("button", { name: "Maximize dock", exact: true }).click();
  const input = dock(page).locator(".xterm-helper-textarea");
  await expect(input).toHaveCount(1);
  await input.focus(); await input.pressSequentially("echo fixture"); await input.press("Enter");
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_write")).map(c => c.request.data).join("")).toContain("echo fixture\r");
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_resize")).length).toBeGreaterThan(0);
  const before = (await calls(page, "cluster_pod_stream_resize")).length;
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_resize")).length).toBeGreaterThan(before);
  for (const c of await calls(page, "cluster_pod_stream_resize")) {
    expect(c.request.cols).toBeGreaterThan(0); expect(c.request.rows).toBeGreaterThan(0);
    expect(c.request.cols).toBeLessThanOrEqual(1000); expect(c.request.rows).toBeLessThanOrEqual(1000);
  }
  await dock(page).getByRole("combobox", { name: "Shell", exact: true }).click();
  await page.getByRole("option", { name: "bash", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).at(-1)!.request.shell).toBe("bash");
  await dock(page).getByRole("button", { name: "Restore dock", exact: true }).click();
  await action(page, "Attach");
  await expect(dock(page)).toContainText("existing process");
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).at(-1)!.request.mode).toBe("attach");
  await dock(page).getByRole("tabpanel").filter({ visible: true }).locator(".xterm-helper-textarea").press("Enter");
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
  await expect(dock(page)).toHaveCount(0); await allStreamsClosed(page);
  await expect(page.getByText("Pods unavailable while disconnected.", { exact: false })).toBeVisible();
});

for (const [label, actionName, warning] of [
  ["Delete", "delete", "A workload controller may create a replacement"],
  ["Force delete", "forceDelete", "without waiting for the process to stop"],
  ["Finalize", "finalize", "bypasses cleanup and may leave resources behind"],
] as const) {
  test(`${label} only mutates after explicit scoped UID/version confirmation`, async ({ page }) => {
    await fixture(page); await action(page, "Details");
    await inspector(page).getByRole("button", { name: label, exact: true }).click();
    const dialog = mutationDialog(page);
    await expect(dialog).toContainText(warning);
    await expect(dialog).toContainText("Cluster: one. Namespace: team-a. Pod: api-pod. UID: pod-uid-123. Resource version: 42.");
    expect(await calls(page, "cluster_pod_mutate")).toHaveLength(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await calls(page, "cluster_pod_mutate")).toHaveLength(0);
    await inspector(page).getByRole("button", { name: label, exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm mutation", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await calls(page, "cluster_pod_mutate")).map(c => c.request)).toEqual([
      { clusterId: "one", sessionId: expect.stringMatching(/^lease-/), namespace: "team-a", name: "api-pod", uid: "pod-uid-123", resourceVersion: "42", action: actionName, yaml: null },
    ]);
  });
}

test("YAML edits are retained after conflict; save confirms exact UID/version and edited content", async ({ page }) => {
  await fixture(page, { mutateError: "conflict" }); await action(page, "Edit YAML");
  const yaml = inspector(page).getByRole("textbox", { name: "YAML", exact: true });
  await expect(yaml).toBeEditable();
  const edited = `${await yaml.textContent()}# fixture edit\n`;
  await yaml.fill(edited);
  await inspector(page).getByRole("button", { name: "Save YAML", exact: true }).click();
  const dialog = mutationDialog(page);
  await expect(dialog).toContainText("Protected server fields are preserved");
  expect(await calls(page, "cluster_pod_mutate")).toHaveLength(0);
  await dialog.getByRole("button", { name: "Confirm mutation", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("The Pod changed or was replaced");
  expect((await calls(page, "cluster_pod_mutate"))[0].request).toMatchObject({ action: "replace", uid: "pod-uid-123", resourceVersion: "42", yaml: edited });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(yaml).toHaveText(edited);
  await control(page, { mutateError: undefined });
  await inspector(page).getByRole("button", { name: "Save YAML", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm mutation", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("port forwarding resolves UID, shows loopback engine state and stops on close", async ({ page }) => {
  await fixture(page); await action(page, "Port forward");
  await expect(dock(page)).toContainText("binds only to 127.0.0.1");
  await expect(dock(page).getByRole("textbox", { name: "Remote port", exact: true })).toHaveValue("8080");
  await dock(page).getByRole("button", { name: "Start forward", exact: true }).click();
  await expect(dock(page)).toContainText("127.0.0.1:43210 → 8080 · running");
  expect((await calls(page, "cluster_pod_forward_start"))[0].request).toEqual({ clusterId: "one", sessionId: expect.any(String), namespace: "team-a", name: "api-pod", uid: "pod-uid-123", remotePort: 8080, localPort: 0 });
  await dock(page).getByRole("button", { name: "Stop forward 43210", exact: true }).click();
  await expect(dock(page)).toContainText("No active forwards returned");
  await dock(page).getByRole("button", { name: "Start forward", exact: true }).click();
  await expect(dock(page)).toContainText("127.0.0.1:43210");
  await dock(page).getByRole("button", { name: "Close api-pod forward", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_pod_forward_stop")).map(c => c.request.id)).toEqual(["forward-1", "forward-2"]);
});

test("live sync renders the native opening response and polls without losing toolbar actions", async ({ page }) => {
  await fixture(page, { syncOpening: true });
  await clusterAction(page, "Enable live sync");
  await expect(page.getByRole("status").filter({ hasText: /^Live sync: opening$/ })).toBeVisible();
  await expect(row(page)).toBeVisible();
  await expect(row(page)).toContainText("Succeeded");
  await clusterAction(page, "Pause live sync");
  await expect.poll(async () => (await calls(page, "cluster_pod_sync_close")).length).toBe(1);
  await expect(row(page)).toContainText("Running");
});

test("live sync open rejection leaves the table and pause action usable", async ({ page }) => {
  await fixture(page, { syncOpenError: "connectionFailed" });
  await clusterAction(page, "Enable live sync");
  await expect(page.getByRole("status").filter({ hasText: /^Live sync: error$/ })).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(row(page)).toContainText("Running");
  await clusterAction(page, "Pause live sync");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await calls(page, "cluster_pod_sync_read")).toHaveLength(0);
  expect(await calls(page, "cluster_pod_sync_close")).toHaveLength(0);
});

test("live sync updates rows, pauses, retains failures, and closes on namespace change and section navigation without closing the dock", async ({ page }) => {
  await fixture(page); await openLogs(page);
  await clusterAction(page, "Enable live sync");
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Pause live sync", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(grid(page)).toContainText("Succeeded");
  const first = (await calls(page, "cluster_pod_sync_open")).at(-1)!;
  expect(first.request).toMatchObject({ clusterId: "one", kind: "pods", namespace: null, continueToken: null });
  await clusterAction(page, "Pause live sync");
  await expect.poll(async () => (await calls(page, "cluster_pod_sync_close")).length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Enable live sync", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await clusterAction(page, "Enable live sync");
  await expect(grid(page)).toContainText("Succeeded");
  await control(page, { syncError: "permissionDenied" });
  await expect(page.getByRole("alert")).toContainText("Kubernetes permissions");
  await expect(grid(page)).toContainText("Succeeded");
  await expect(page.getByRole("status").filter({ hasText: "Updates unavailable" })).toBeVisible();
  await control(page, { syncError: undefined });
  const namespace = page.getByRole("button", { name: /^Namespace(?:\s|$)/ });
  await namespace.click();
  for (const name of ["team-a", "team-b", "production", "default"]) await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
  await page.getByRole("option", { name: "team-b", exact: true }).click();
  await expect(grid(page)).toContainText("team-b");
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Enable live sync", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await clusterAction(page, "Enable live sync");
  await expect.poll(async () => (await calls(page, "cluster_pod_sync_open")).at(-1)!.request.namespace).toBe("team-b");
  await expect(grid(page)).toContainText("Succeeded");
  const teamBId = `sync-${(await calls(page, "cluster_pod_sync_open")).length}`;
  await namespace.click(); await page.getByRole("option", { name: "production", exact: true }).click();
  await expect(grid(page)).toContainText("production");
  await expect.poll(async () => (await calls(page, "cluster_pod_sync_close")).some(c => c.request.syncId === teamBId)).toBe(true);
  await clusterAction(page, "Enable live sync");
  await expect.poll(async () => (await calls(page, "cluster_pod_sync_open")).at(-1)!.request.namespace).toBe("production");
  await expect(grid(page)).toContainText("Succeeded");
  const closedBefore = (await calls(page, "cluster_pod_sync_close")).length;
  await navigate(page, "services");
  await expect(grid(page)).toHaveCount(0);
  await expect.poll(async () => (await calls(page, "cluster_pod_sync_close")).length).toBeGreaterThan(closedBefore);
  await expect(dock(page).getByLabel("Pod logs", { exact: true })).toContainText("boot ready");
  await expect(grid(page, "Services")).toBeVisible();
  expect((await calls(page, "cluster_resources")).filter(call => call.request.kind === "namespaces")).toHaveLength(1);
  await expect(dock(page)).toBeVisible();
  await navigate(page, "overview");
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
  await allStreamsClosed(page);
});

test("late live sync open closes on view disposal; navigation releases the session and pending streams", async ({ page }) => {
  await fixture(page, { holdSync: true, holdStreams: true });
  await action(page, "Logs");
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).length).toBeGreaterThan(0);
  await clusterAction(page, "Enable live sync");
  await expect.poll(async () => (await calls(page, "cluster_pod_sync_open")).length).toBeGreaterThan(0);
  await page.evaluate(() => { location.hash = "/catalog"; });
  await page.evaluate(() => { (window as MockWindow).__releasePodStreams(); (window as MockWindow).__releasePodSync(); });
  await allStreamsClosed(page);
  await expect.poll(async () => {
    const opens = await calls(page, "cluster_pod_sync_open");
    const closes = await calls(page, "cluster_pod_sync_close");
    return opens.every((_, i) => closes.some(c => c.request.syncId === `sync-${i + 1}`));
  }).toBe(true);
  const leases = await calls(page, "cluster_session_open");
  await expect.poll(async () => (await calls(page, "cluster_disconnect")).length).toBeGreaterThanOrEqual(leases.length);
  await expect(dock(page)).toHaveCount(0);
});

test("invalid stream DTO closes recognizable stream handles and exposes an error", async ({ page }) => {
  await fixture(page, { malformedStream: true }); await action(page, "Logs");
  await expect(dock(page).getByRole("alert")).toContainText("unsupported response");
  await allStreamsClosed(page);
  expect(await calls(page, "cluster_pod_stream_read")).toHaveLength(0);
});

test("details reload retains stale values after failure and scoped child actions reject a replaced UID", async ({ page }) => {
  await fixture(page); await action(page, "Details");
  await expect(fact(page, "Resource version")).toHaveText("42");
  await control(page, { detailError: "resourceUnavailable" });
  await inspector(page).getByRole("button", { name: "Refresh details", exact: true }).click();
  await expect(inspector(page).getByRole("alert")).toContainText("Retained details may be stale");
  await expect(fact(page, "Resource version")).toHaveText("42");
  await control(page, { detailError: undefined, malformedDetails: true });
  await inspector(page).getByRole("button", { name: "Logs", exact: true }).click();
  await expect(dock(page).getByRole("tabpanel").filter({ visible: true }).getByRole("alert")).toContainText("unsupported response");
  expect(await calls(page, "cluster_pod_stream_open")).toHaveLength(0);
});

test("narrow dock keeps tab selection and show/close controls reachable without window overflow", async ({ page }) => {
  await fixture(page); await openLogs(page); await action(page, "Shell");
  await page.setViewportSize({ width: 390, height: 844 });
  await dock(page).getByRole("button", { name: "Minimize dock", exact: true }).click();
  await dock(page).getByRole("button", { name: "Show dock", exact: true }).click();
  await dock(page).getByRole("button", { name: "Maximize dock", exact: true }).click();
  const shell = dock(page).getByRole("tab", { name: "api-pod · shell", exact: true });
  await shell.focus(); await shell.press("ArrowLeft");
  await expect(dock(page).getByRole("tab", { name: "api-pod · logs", exact: true })).toBeFocused();
  await expect(dock(page).getByRole("textbox", { name: "Search buffered logs", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const name of ["Minimize dock", "Restore dock"]) {
    const box = await dock(page).getByRole("button", { name, exact: true }).boundingBox();
    expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  await dock(page).getByRole("tab", { name: "api-pod · logs", exact: true }).press("Control+w");
  await shell.focus(); await shell.press("Control+w"); await allStreamsClosed(page);
});

test("compact dock keeps long Pod names from consuming the stream viewport", async ({ page }) => {
  const name = "alb-internal-ingress-nginx-controller-5f8f95959b-bvh69";
  await fixture(page, { podName: name }); await action(page, "Logs", name);
  const podDock = dock(page);
  const output = podDock.getByLabel("Pod logs", { exact: true });
  await expect(output).toContainText("boot ready");
  await expect(podDock.getByRole("button", { name: "Tab actions", exact: true })).toBeVisible();
  await expect(podDock.getByRole("button", { name: "Minimize dock", exact: true })).toBeVisible();
  const metrics = await podDock.evaluate(element => {
    const panel = element.querySelector<HTMLElement>('[role="tabpanel"]');
    const log = element.querySelector<HTMLElement>('[aria-label="Pod logs"]');
    const tabs = element.querySelector<HTMLElement>('[role="tablist"]');
    return { panelHeight: panel?.getBoundingClientRect().height ?? 0, logHeight: log?.getBoundingClientRect().height ?? 0, tabsHeight: tabs?.getBoundingClientRect().height ?? 0 };
  });
  expect(metrics.logHeight).toBeGreaterThan(0);
  expect(metrics.tabsHeight).toBeLessThan(80);
  expect(metrics.logHeight / metrics.panelHeight).toBeGreaterThan(0.6);
});


test("stream read failures and ended streams can restart without closing their tab", async ({ page }) => {
  await fixture(page); await action(page, "Shell");
  await expect(dock(page).locator(".xterm-helper-textarea")).toHaveCount(1);
  await control(page, { streamReadError: "processUnavailable" });
  await expect(dock(page).getByRole("alert")).toContainText("container process is unavailable");
  await expect(dock(page).getByRole("status").filter({ hasText: /^error$/ })).toBeVisible();
  const failedReads = (await calls(page, "cluster_pod_stream_read")).length;
  await page.waitForTimeout(600);
  expect(await calls(page, "cluster_pod_stream_read")).toHaveLength(failedReads);
  const opens = (await calls(page, "cluster_pod_stream_open")).length;
  await control(page, { streamReadError: undefined, streamStatus: "exited" });
  await dock(page).getByRole("button", { name: "Restart stream", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_pod_stream_open")).length).toBe(opens + 1);
  await expect(dock(page).getByRole("status").filter({ hasText: /^exited$/ })).toBeVisible();
  await expect(dock(page).getByRole("tab")).toHaveCount(1);
  await control(page, { streamStatus: "running" });
  await dock(page).getByRole("button", { name: "Restart stream", exact: true }).click();
  await expect(dock(page).getByRole("status").filter({ hasText: /^running$/ })).toBeVisible();
  await dock(page).getByRole("button", { name: "Close api-pod shell", exact: true }).click();
  await allStreamsClosed(page);
});

test("shell and attach exclude terminated containers; no running containers never opens a stream", async ({ page }) => {
  await fixture(page);
  for (const mode of ["Shell", "Attach"]) {
    await action(page, mode);
    await dock(page).getByRole("combobox", { name: "Container", exact: true }).click();
    await expect(page.getByRole("option", { name: "app (container)", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "setup (init)", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await dock(page).getByRole("button", { name: `Close api-pod ${mode.toLowerCase()}`, exact: true }).click();
  }
  await allStreamsClosed(page);
  const opens = (await calls(page, "cluster_pod_stream_open")).length;
  await control(page, { noRunningContainers: true });
  await action(page, "Shell");
  await expect(dock(page).getByRole("alert")).toHaveText("This Pod has no running containers.");
  expect(await calls(page, "cluster_pod_stream_open")).toHaveLength(opens);
});

test("closing an active middle tab selects its neighbor and restores keyboard focus", async ({ page }) => {
  await fixture(page); await action(page, "Port forward"); await openLogs(page); await action(page, "Shell");
  const logs = dock(page).getByRole("tab", { name: "api-pod · logs", exact: true });
  const shell = dock(page).getByRole("tab", { name: "api-pod · shell", exact: true });
  await logs.click();
  await dock(page).getByRole("button", { name: "Close api-pod logs", exact: true }).click();
  await expect(shell).toHaveAttribute("aria-selected", "true"); await expect(shell).toBeFocused();
  await shell.press("Delete");
  const forward = dock(page).getByRole("tab", { name: "api-pod · forward", exact: true });
  await expect(forward).toHaveAttribute("aria-selected", "true"); await expect(forward).toBeFocused();
  await forward.press("Delete"); await expect(dock(page)).toHaveCount(0);
  await expect(row(page).getByRole("button", { name: "api-pod", exact: true })).toBeFocused();
  await allStreamsClosed(page);
});

async function clusterAction(page: Page, name: string) {
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
