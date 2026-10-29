import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(() => {
    let sequence = 0;
    const calls: { command: string; request: Record<string, unknown> }[] = [];
    const base = {
      roles: ["worker"], taints: 0, version: "v1.36.0", internalIps: ["10.0.0.1", "2001:db8::1"],
      schedulable: true, diskAllocatable: null, metricsTimestamp: null,
      cpu: { used: null, allocatable: 7.5, capacity: 8 },
      memory: { used: null, allocatable: 16 * 1024 ** 3, capacity: 20 * 1024 ** 3 },
      conditions: [
        { type: "Ready", status: "True" },
        { type: "MemoryPressure", status: "False" },
        { type: "DiskPressure", status: "True" },
        { type: "HostUpgrades", status: "True" },
        { type: "CustomHealthy", status: "True" },
        { type: "CustomInactive", status: "False" },
        { type: "CustomUncertain", status: "Unknown" },
      ],
    };
    const items = [
      { name: "node-a", namespace: null, status: "Ready", createdAt: null, columns: {}, node: base },
      { name: "node-a-other", namespace: null, status: "Ready", createdAt: null, columns: {}, node: {
        ...base, roles: ["control-plane"], version: "v1.35.0", internalIps: ["10.0.0.2"],
        conditions: [{ type: "Ready", status: "Unknown" }],
      } },
    ];
    Object.assign(window, { isTauri: true, __diagnosticCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
        const request = args?.request ?? {};
        calls.push({ command, request });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "cluster_namespace_cache_get") return null;
        if (command === "cluster_namespace_cache_refresh") return {
          clusterId: request.clusterId, sessionId: request.sessionId, names: [],
          fetchedAt: Date.now(), expiresAt: Date.now() + 30_000, partial: false,
        };
        if (command === "cluster_permissions_review") {
          const checkedAt = Date.now();
          return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
            authorizationEpoch: `fixture-${request.sessionId}`, revision: request.readId, checkedAt, expiresAt: checkedAt + 30_000,
            items: (request.checks as unknown[]).map(check => ({ check, decision: "allowed", reason: null })) };
        }
        if (["cluster_permissions_cancel", "cluster_permissions_refresh", "cluster_disconnect", "cluster_resources_cancel"].includes(command)) return null;
        if (command === "cluster_session_open" || command === "cluster_connect") return {
          clusterId: request.clusterId, sessionId: request.sessionId ?? `lease-${++sequence}`, contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected",
          apiVersion: command === "cluster_connect" ? "v1.36.0" : null, error: null,
        };
        if (command === "cluster_resources") {
          if (request.kind !== "nodes") throw `Unexpected kind: ${request.kind}`;
          const needle = String(request.query ?? "").toLowerCase();
          // IPC model only; Rust fixture tests verify the production search projection.
          const matched = items.filter(item => [item.name, item.status, ...item.node.roles,
            item.node.version, ...item.node.internalIps,
            ...item.node.conditions.flatMap(condition => [condition.type, condition.status]),
          ].some(value => value.toLowerCase().includes(needle)));
          const offset = Number(request.continueToken ?? 0);
          const pageItems = matched.slice(offset, offset + 1);
          const more = offset + pageItems.length < matched.length;
          return { ...request, namespace: null, continueToken: more ? String(offset + 1) : null,
            truncated: more, fetchedAt: Date.now(), metrics: "unavailable", items: pageItems };
        }
        throw `Unexpected command: ${command}`;
      },
    } });
  });
  await page.setViewportSize({ width: 1563, height: 850 });
  await page.goto("/#/cluster/one?section=nodes");
  await expect(table(page)).toBeVisible();
  await expect(table(page).getByRole("button", { name: "node-a", exact: true })).toBeVisible();
}
const table = (page: Page) => page.getByRole("table", { name: "Nodes", exact: true });
const search = (page: Page) => page.getByRole("textbox", { name: "Search nodes", exact: true });

test("active custom conditions are visible without inferring unhealthy status", async ({ page }) => {
  await fixture(page);
  const conditions = table(page).getByRole("row").nth(1).getByRole("cell").nth(11);
  await expect(conditions).toContainText("Ready");
  for (const type of ["DiskPressure", "HostUpgrades", "CustomHealthy"]) {
    const badge = conditions.getByText(`${type}: True`, { exact: true });
    await expect(badge).toBeVisible();
    const background = () => badge.evaluate(element => getComputedStyle(element.closest(".resource-status-badge")!).backgroundColor);
    const pressureBackground = await conditions.getByText("DiskPressure: True", { exact: true })
      .evaluate(element => getComputedStyle(element.closest(".resource-status-badge")!).backgroundColor);
    if (type !== "DiskPressure") expect(await background()).not.toBe(pressureBackground);
  }
  await expect(conditions.getByRole("button", { name: "+3 conditions", exact: true })).toBeVisible();
  for (const label of ["MemoryPressure: False", "CustomInactive: False", "CustomUncertain: Unknown"]) {
    await expect(conditions).not.toContainText(label);
  }
  await expect(table(page).getByRole("progressbar")).toHaveCount(0);
  await expect(table(page)).toContainText("N/A / 7.50");
  await page.getByRole("button", { name: "Next nodes page", exact: true }).click();
  await expect(table(page)).toContainText("Ready: Unknown");
  await expect(table(page)).not.toContainText("HostUpgrades");
});

test("diagnostic search crosses pages and resets continuation with scoped IPC", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Next nodes page", exact: true }).click();
  await expect(table(page)).toContainText("node-a-other");
  for (const query of ["10.0.0.1", "2001:DB8::1", "HOSTUPGRADES", "customhealthy", "custominactive", "FALSE", "customuncertain", "WoRkEr", "V1.36.0"]) {
    await search(page).fill(query);
    await expect.poll(() => page.evaluate(query => {
      const calls = (window as unknown as { __diagnosticCalls: { command: string; request: Record<string, unknown> }[] }).__diagnosticCalls;
      return calls.some(call => call.command === "cluster_resources" && call.request.query === query);
    }, query)).toBe(true);
    await expect(table(page).getByRole("button", { name: "node-a", exact: true })).toBeVisible();
    await expect(table(page)).not.toContainText("node-a-other");
    await expect(page.getByRole("button", { name: "Previous nodes page", exact: true })).toBeDisabled();
  }
  await search(page).fill("uNkNoWn");
  await expect(table(page)).toContainText("node-a");
  await expect(page.getByRole("button", { name: "Next nodes page", exact: true })).toBeEnabled();
  await search(page).fill("not-present");
  await expect(table(page)).toContainText("No matching nodes on this page.");
  await search(page).fill("");
  await expect(table(page).getByRole("button", { name: "node-a", exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { __diagnosticCalls: { command: string; request: Record<string, unknown> }[] }).__diagnosticCalls);
  const queries = calls.filter(call => call.command === "cluster_resources" && call.request.query);
  expect(queries.map(call => call.request.query)).toContain("2001:DB8::1");
  for (const call of queries) {
    expect(call.request).toMatchObject({ clusterId: "one", kind: "nodes", namespace: null, continueToken: null });
    expect(call.request.sessionId).toBeTruthy();
  }
});
