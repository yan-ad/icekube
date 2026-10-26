import { expect, test, type Page } from "@playwright/test";
import { resourceViews } from "../src/app/cluster/resourceViews";

type Call = { command: string; request: Record<string, string | number | null> };
type Controls = { failure?: string; malformed?: string; empty?: boolean; hold?: boolean; failContinuation?: boolean };
type MockWindow = Window & {
  __resourceCalls: Call[];
  __resourceControls: Controls;
  __releaseResources: () => void;
};
const route = (section: string) => `/#/cluster/one?section=${section}`;
const table = (page: Page, name = "Pods") => page.getByRole("table", { name, exact: true });

test("failed continuation keeps the last page and allows returning to it", async ({ page }) => {
  await fixture(page, { failContinuation: true }); await ready(page);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("resource is unavailable");
  await expect(table(page)).toContainText("shared-name");
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(table(page)).toContainText("shared-name");
});
const calls = (page: Page, command = "cluster_resources", kind?: string) => page.evaluate(
  ({ command, kind }) => (window as MockWindow).__resourceCalls.filter((call) => call.command === command &&
    (command !== "cluster_resources" || (kind ? call.request.kind === kind : call.request.kind !== "namespaces"))), { command, kind },
);
async function selectNamespace(page: Page, namespace: string) {
  const selector = page.getByRole("button", { name: /^Namespace(?:\s|$)/ });
  await expect(selector).toBeVisible();
  await expect(page.getByText("Loading namespaces…", { exact: true })).toHaveCount(0);
  await selector.click();
  await page.getByRole("option", { name: namespace, exact: true }).click();
}
async function controls(page: Page, value: Controls) {
  await page.evaluate((value) => Object.assign((window as MockWindow).__resourceControls, value), value);
}

test("parent menus expose destination tables without resource fan-out", async ({ page }) => {
  await fixture(page, { section: "workloads" });
  await expect(table(page, "Workloads destinations")).toBeVisible();
  expect(await calls(page)).toHaveLength(0);
  await table(page, "Workloads destinations").getByRole("link", { name: "Pods", exact: true }).click();
  await ready(page);
  const connects = await calls(page, "cluster_connect");
  for (const [section, label] of [["config", "Config"], ["network", "Network"], ["storage", "Storage"], ["helm", "Helm"], ["access-control", "Access Control"], ["custom-resources", "Custom Resources"], ["workloads-overview", "Overview"], ["overview", "Cluster"]]) {
    const before = await calls(page);
    await navigate(page, section);
    await expect(table(page, `${label} destinations`)).toBeVisible();
    expect(await calls(page)).toEqual(before);
  }
  expect(await calls(page, "cluster_connect")).toEqual(connects);
});

test("Nodes retains its own table and lease across resource navigation", async ({ page }) => {
  await fixture(page, { section: "nodes" });
  await expect(table(page, "Nodes")).toContainText("node-a");
  await expect(table(page, "Nodes").getByRole("columnheader", { name: "CPU", exact: true })).toBeVisible();
  const connects = await calls(page, "cluster_connect");
  await navigate(page, "pods"); await ready(page);
  await navigate(page, "nodes");
  await expect(table(page, "Nodes")).toContainText("node-a");
  expect(await calls(page, "cluster_connect")).toEqual(connects);
});
async function navigate(page: Page, section: string) {
  await page.evaluate((section) => { location.hash = `/cluster/one?section=${section}`; }, section);
}
async function fixture(page: Page, options: Controls & { legacyPreference?: boolean; section?: string } = {}) {
  page.on("pageerror", (error) => { throw error; });
  await page.addInitScript(({ options, views }) => {
    if (options.legacyPreference !== undefined) localStorage.setItem("icekube.resource-tables.v1", String(options.legacyPreference));
    let session = 0;
    const calls: Call[] = [];
    const control = { ...options };
    const pending: (() => void)[] = [];
    Object.assign(window, { isTauri: true, __resourceCalls: calls, __resourceControls: control,
      __releaseResources: () => pending.splice(0).forEach((resolve) => resolve()),
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: { request: Call["request"] }) => {
          const request = { ...args?.request };
          calls.push({ command, request });
          if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
            { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [],
              color: "#476BA1", pinned: false, status: "disconnected" },
          ] };
          if (command === "cluster_session_open" || command === "cluster_connect") return {
            clusterId: request.clusterId, sessionId: request.sessionId ?? `lease-${++session}`, contextName: "dev",
            status: command === "cluster_connect" ? "connected" : "disconnected",
            apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null,
          };
          if (command === "cluster_disconnect" || command === "cluster_resources_cancel" || command === "helm_cancel") return;
          if (command === "helm_table") return { clusterId: request.clusterId, sessionId: request.sessionId,
            view: request.view, namespace: request.namespace ?? null, readId: request.readId, truncated: false, items: [{ id: "helm-row", name: "sample-chart", namespace: request.view === "releases" ? String(request.namespace ?? "team-a") : null,
              version: "1.2.3", appVersion: "4.5.6", description: request.view === "releases" ? null : "Cached chart", status: request.view === "releases" ? "deployed" : null,
              revision: request.view === "releases" ? 1 : null, updated: request.view === "releases" ? "2026-10-26T00:00:00Z" : null }] };
          if (command === "cluster_pod_forward_list") return [{ ...request, id: "forward-one", namespace: "team-a", name: "sample-pod",
            remotePort: 8080, localPort: 49152, status: "running", error: null }];
          if (command !== "cluster_resources") throw `Unexpected mock command: ${command}`;
          if (request.kind === "namespaces" && !location.hash.includes("section=namespaces")) return {
            ...request, namespace: null, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null,
            items: ["team-a", "team-b", "production", "default"].map((name) => ({
              name, namespace: null, status: "Active", createdAt: null, columns: {}, node: null,
            })),
          };
          if (request.kind === "nodes") return { ...request, namespace: null, continueToken: null, truncated: false,
            fetchedAt: Date.now(), metrics: null, items: [{ name: "node-a", status: "Ready", namespace: null, createdAt: null, columns: {}, node: null }] };
          const view = views.find((view) => view.kind === request.kind);
          if (!view) throw "invalidInput";
          if (control.hold) await new Promise<void>((resolve) => pending.push(resolve));
          if (control.failContinuation && request.continueToken) throw "resourceUnavailable";
          if (control.failure) throw control.failure;
          const columns = Object.fromEntries(view.columns.map((column) => [column.key, `fact-${column.key}`]));
          const item = (name: string, namespace: string | null, status: string, group: string) => ({
            name, namespace, status, createdAt: "2026-01-01T00:00:00Z", node: null,
            columns: request.kind === "customResourceDefinitions" ? { ...columns, group } : columns,
            data: { "private-key-name": "PRIVATE_VALUE_MUST_NOT_ESCAPE" },
            stringData: { "another-private-key": "ANOTHER_PRIVATE_VALUE" },
          });
          const ns = view.namespaced ? String(request.namespace ?? "team-a") : null;
          const items = request.continueToken
            ? [item("second-page", ns, "Active", "apps.example.test")]
            : [item("shared-name", ns, "Active", "apps.example.test"),
              item(view.namespaced && request.namespace == null ? "shared-name" : "other-name",
                view.namespaced && request.namespace == null ? "team-b" : ns, "Pending", "ops.example.test")];
          const response = { ...request, namespace: request.namespace ?? null, items: control.empty ? [] : items,
            fetchedAt: Date.now(), truncated: !request.continueToken, continueToken: request.continueToken ? null : "next-page-token", metrics: null };
          switch (control.malformed) {
            case "namespace": response.namespace = "wrong-namespace"; break;
            case "session": response.sessionId = "wrong-session"; break;
            case "readId": response.readId = -1; break;
            case "columns": items[0].columns = { bad: 42 } as unknown as typeof columns; break;
            case "duplicate": response.items = [items[0], items[0]]; break;
            case "timestamp": items[0].createdAt = "not-a-time"; break;
            case "token": response.continueToken = "bad\ntoken"; break;
          }
          return response;
        },
      },
    });
  }, { options, views: resourceViews });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(route(options.section ?? "pods"));
  await expect(page.getByRole("switch", { name: "Resource tables", exact: true })).toHaveCount(0);
}
async function ready(page: Page, name = "Pods") {
  await expect(table(page, name)).toBeVisible();
  await expect(table(page, name).getByRole("row")).toHaveCount(3);
  await expect(page.getByText("Loading namespaces…", { exact: true })).toHaveCount(0);
}

test("all 43 registry views expose their direct route, columns and read-only contract", async ({ page }) => {
  test.setTimeout(120_000);
  expect(resourceViews).toHaveLength(43);
  await fixture(page);
  for (const view of resourceViews) {
    await test.step(view.section, async () => {
      await navigate(page, view.section);
      const helm = view.section === "helm-charts" || view.section === "helm-releases";
      const forward = view.section === "port-forwarding";
      const grid = table(page, helm ? `Helm ${view.label}` : forward ? "Port forwards" : view.label);
      await expect(grid).toBeVisible();
      await expect(grid.getByRole("columnheader")).toHaveText(helm ? (view.section === "helm-charts"
        ? ["Name", "Version", "App version", "Description"]
        : ["Name", "Namespace", "Chart", "App version", "Status", "Revision", "Updated"])
        : forward ? ["Name", "Namespace", "Pod", "Port", "Local Port", "Address", "Status", "Actions"]
        : ["Name", ...(view.namespaced ? ["Namespace"] : []), ...view.columns.map((column) => column.label), "Age", "Status", ...(view.kind === "pods" ? ["Actions"] : [])]);
      await expect(page.getByText(/service is not implemented|unavailable because|Live .* data is not implemented yet/)).toHaveCount(0);
      if (view.kind) {
        await expect(grid.getByRole("row")).toHaveCount(3);
        const read = (await calls(page, "cluster_resources", view.kind)).at(-1)!.request;
        expect(read).toMatchObject({ clusterId: "one", kind: view.kind, namespace: null, continueToken: null });
        expect(read.sessionId).toMatch(/^lease-/);
        expect(read.readId).toEqual(expect.any(Number));
        for (const column of view.columns) await expect(grid).toContainText(
          view.kind === "customResourceDefinitions" && column.key === "group" ? "apps.example.test" : `fact-${column.key}`,
        );
        await expect(page.getByRole("button", { name: /^Namespace(?:\s|$)/ })).toHaveCount(view.namespaced ? 1 : 0);
      } else {
        expect(helm || forward).toBe(true);
        await expect(grid.getByRole("row")).toHaveCount(2);
        await expect(page.getByRole("textbox", { name: forward ? "Search forwards" : `Search ${view.label}`, exact: true })).toBeEnabled();
        const serviceCalls = await calls(page, helm ? "helm_table" : "cluster_pod_forward_list");
        expect(serviceCalls.at(-1)!.request).toMatchObject({ clusterId: "one", sessionId: expect.stringMatching(/^lease-/) });
        if (helm) expect(serviceCalls.at(-1)!.request).toEqual({ clusterId: "one", sessionId: expect.stringMatching(/^lease-/),
          view: view.section === "helm-charts" ? "charts" : "releases", namespace: null, readId: expect.any(Number) });
      }
      if (view.createLabel) {
        const create = page.getByRole("button", { name: view.createLabel, exact: true });
        await expect(create).toBeDisabled();
        const beforeAction = await calls(page, "cluster_connect");
        await create.dispatchEvent("click");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(await calls(page, "cluster_connect")).toEqual(beforeAction);
        expect((await page.evaluate(() => (window as MockWindow).__resourceCalls)).every(
          (call) => ["catalog_list", "cluster_session_open", "cluster_connect", "cluster_disconnect", "cluster_resources", "cluster_resources_cancel", "helm_table", "helm_cancel", "cluster_pod_forward_list"].includes(call.command),
        )).toBe(true);
      }
    });
  }
});

test("namespace selector loads known namespaces and applies immediately", async ({ page }) => {
  await fixture(page); await ready(page);
  await expect(table(page).getByRole("cell", { name: "shared-name", exact: true })).toHaveCount(2);
  await expect(table(page)).toContainText("team-a"); await expect(table(page)).toContainText("team-b");
  const before = (await calls(page)).length;
  await selectNamespace(page, "production");
  await expect(page.getByRole("status").filter({ hasText: /namespace production$/ })).toBeVisible();
  expect((await calls(page)).at(-1)!.request).toMatchObject({ namespace: "production", continueToken: null });
  await selectNamespace(page, "team-a");
  await expect(page.getByRole("status").filter({ hasText: /namespace team-a$/ })).toBeVisible();
  await selectNamespace(page, "All namespaces");
  await expect(page.getByRole("status").filter({ hasText: /all namespaces$/ })).toBeVisible();
  expect((await calls(page)).at(-1)!.request.namespace).toBeNull();
  expect((await calls(page)).length).toBeGreaterThan(before);
});

test("search and Status filter loaded rows locally and distinguish filtered empty", async ({ page }) => {
  await fixture(page); await ready(page);
  const before = await calls(page);
  const search = page.getByRole("textbox", { name: "Search Pods", exact: true });
  await search.fill(" TEAM-B ");
  await expect(table(page).getByRole("row")).toHaveCount(2);
  await expect(table(page)).toContainText("team-b");
  await search.fill("FACT-QOS"); await expect(table(page).getByRole("row")).toHaveCount(3);
  await search.fill("");
  await page.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "Pending", exact: true }).click();
  await expect(table(page).getByRole("row")).toHaveCount(2);
  await expect(table(page)).toContainText("team-b");
  await search.fill("absent");
  await expect(table(page)).toContainText("No pods match your filters.");
  await expect(table(page)).not.toContainText("No pods were returned.");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await ready(page); await expect(search).toHaveValue("");
  expect(await calls(page)).toEqual(before);
});

test("CRD Group filter combines with Status and clears without another read", async ({ page }) => {
  await fixture(page, { section: "custom-resource-definitions" }); await ready(page, "Definitions");
  const before = await calls(page);
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await page.getByRole("option", { name: "apps.example.test", exact: true }).click();
  await expect(table(page, "Definitions").getByRole("row")).toHaveCount(2);
  await expect(table(page, "Definitions")).not.toContainText("other-name");
  await page.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "Pending", exact: true }).click();
  await expect(table(page, "Definitions")).toContainText("No definitions match your filters.");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await ready(page, "Definitions"); expect(await calls(page)).toEqual(before);
});

test("pagination and namespace changes cancel scoped reads and reset continuation", async ({ page }) => {
  await fixture(page); await ready(page);
  const first = (await calls(page)).at(-1)!.request;
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: /partial page of at most 100/ })).toBeVisible();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(table(page)).toContainText("second-page");
  expect((await calls(page)).at(-1)!.request).toMatchObject({ namespace: null, continueToken: "next-page-token" });
  expect((await calls(page, "cluster_resources_cancel")).some((call) => JSON.stringify(call.request) === JSON.stringify(first))).toBe(true);
  await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Previous page", exact: true }).click(); await ready(page);
  expect((await calls(page)).at(-1)!.request.continueToken).toBeNull();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(table(page)).toContainText("second-page");
  const previous = (await calls(page)).at(-1)!.request;
  await selectNamespace(page, "production"); await ready(page);
  expect((await calls(page)).at(-1)!.request).toMatchObject({ namespace: "production", continueToken: null });
  await expect(page.getByRole("status").filter({ hasText: /page 1.*namespace production/ })).toBeVisible();
  expect((await calls(page, "cluster_resources_cancel")).some((call) => call.request.readId === previous.readId)).toBe(true);
  const scoped = (await calls(page)).at(-1)!.request;
  await navigate(page, "services"); await ready(page, "Services");
  expect((await calls(page, "cluster_resources_cancel")).some((call) => call.request.readId === scoped.readId)).toBe(true);
  expect((await calls(page)).at(-1)!.request).toMatchObject({ kind: "services", namespace: null, continueToken: null });
});

test("late results from a cancelled namespace read cannot replace the current scope", async ({ page }) => {
  await fixture(page); await ready(page);
  await controls(page, { hold: true });
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Loading pods…" })).toBeVisible();
  const pending = (await calls(page)).at(-1)!.request;
  await controls(page, { hold: false });
  await selectNamespace(page, "production");
  await ready(page);
  await expect.poll(async () => (await calls(page, "cluster_resources_cancel")).some(
    (call) => JSON.stringify(call.request) === JSON.stringify(pending),
  )).toBe(true);
  await page.evaluate(() => (window as MockWindow).__releaseResources());
  await expect(table(page)).not.toContainText("second-page");
  await expect(table(page)).toContainText("production");
  await expect(page.getByRole("status").filter({ hasText: /page 1.*namespace production/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
});

test("resource tables default on and navigation preserves the lease", async ({ page }) => {
  await fixture(page); await ready(page);
  const connections = await calls(page, "cluster_connect");
  await navigate(page, "services"); await ready(page, "Services");
  await navigate(page, "pods"); await ready(page);
  expect(await calls(page, "cluster_connect")).toEqual(connections);
  expect(await page.evaluate(() => localStorage.getItem("icekube.resource-tables.v1"))).toBeNull();
});

test("resource tables ignore a false legacy preference through navigation and reload", async ({ page }) => {
  await fixture(page, { legacyPreference: false });
  await ready(page);
  const connections = await calls(page, "cluster_connect");
  await navigate(page, "services"); await ready(page, "Services");
  expect(await calls(page, "cluster_connect")).toEqual(connections);
  await page.reload(); await ready(page, "Services");
  await expect(page.getByRole("switch", { name: "Resource tables", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("icekube.resource-tables.v1"))).toBe("false");
});

for (const [failure, message, section] of [
  ["permissionDenied", "Kubernetes permissions", "pods"],
  ["resourceUnavailable", "resource is unavailable", "pod-security-policies"],
] as const) {
  test(`${failure} (including removed API/404) is an error, never an empty inventory`, async ({ page }) => {
    await fixture(page, { failure, section });
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText(/were returned/)).toHaveCount(0);
    expect((await calls(page)).at(-1)!.request.kind).toBe(section === "pods" ? "pods" : "podSecurityPolicies");
  });
}
for (const malformed of ["namespace", "session", "readId", "columns", "duplicate", "timestamp", "token"]) {
  test(`malformed ${malformed} DTO fails closed without a fake empty table`, async ({ page }) => {
    await fixture(page, { malformed });
    await expect(page.getByRole("alert")).toContainText("unsupported response");
    await expect(table(page)).toHaveCount(0);
    await expect(page.getByText(/were returned/)).toHaveCount(0);
  });
}

test("failed refresh preserves rows and reports stale data without reconnecting", async ({ page }) => {
  await fixture(page); await ready(page);
  const connections = await calls(page, "cluster_connect");
  await controls(page, { failure: "network" });
  await page.getByRole("button", { name: "Refresh pods", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not be reached");
  await ready(page);
  await expect(page.getByRole("status").filter({ hasText: /Previously fetched pods.*stale/ })).toBeVisible();
  expect(await calls(page, "cluster_connect")).toEqual(connections);
  await controls(page, { failure: "" });
  await page.getByRole("button", { name: "Refresh pods", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText(/Previously fetched pods/)).toHaveCount(0);
});

test("successful empty response is distinct from loading and failures", async ({ page }) => {
  await fixture(page, { hold: true, empty: true });
  await expect(page.getByRole("status").filter({ hasText: "Loading pods…" })).toBeVisible();
  await expect(table(page)).toHaveCount(0);
  await page.evaluate(() => (window as MockWindow).__releaseResources());
  await expect(table(page)).toContainText("No pods were returned.");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const section of ["secrets", "config-maps"]) {
  test(`${section} renders metadata only and the IPC parser discards data fields`, async ({ page }) => {
    const view = resourceViews.find((view) => view.section === section)!;
    await fixture(page, { section }); await ready(page, view.label);
    await expect(page.getByText("Metadata only. Data values and key names are not loaded.", { exact: true })).toBeVisible();
    await expect(table(page, view.label).getByRole("columnheader")).toHaveText(["Name", "Namespace", "Age", "Status"]);
    await expect(page.locator("body")).not.toContainText("PRIVATE_VALUE");
    await expect(page.locator("body")).not.toContainText("private-key-name");
    const parsed = await page.evaluate(async () => {
      const modulePath = "/src/app/cluster/api.ts";
      const api = await import(/* @vite-ignore */ modulePath);
      const request = (window as MockWindow).__resourceCalls.filter((call) => call.command === "cluster_resources" && call.request.kind !== "namespaces").at(-1)!.request;
      return (await api.loadResources({ ...request, readId: api.nextReadId() })).items;
    });
    expect(parsed).toHaveLength(2);
    for (const item of parsed) {
      expect(Object.keys(item).sort()).toEqual(["columns", "createdAt", "name", "namespace", "node", "status"]);
      expect(item.columns).toEqual({}); expect(item.node).toBeNull();
      expect(JSON.stringify(item)).not.toMatch(/private-key|PRIVATE_VALUE|data|stringData/);
    }
  });
}

test("narrow tables scroll internally and search remains labelled and keyboard accessible", async ({ page }) => {
  await fixture(page, { section: "resource-quotas" }); await ready(page, "Resource Quotas");
  for (const width of [360, 640]) {
    await page.setViewportSize({ width, height: 740 });
    const search = page.getByRole("textbox", { name: "Search Resource Quotas", exact: true });
    await expect(search).toBeVisible(); await search.focus(); await expect(search).toBeFocused();
    await page.keyboard.type("TEAM-B");
    await expect(table(page, "Resource Quotas").getByRole("row")).toHaveCount(2);
    await search.fill("");
    const region = page.getByRole("group", { name: "Table", exact: true });
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus(); await expect(region).toBeFocused(); await page.keyboard.press("End");
    expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
