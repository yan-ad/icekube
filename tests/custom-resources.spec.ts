import { expect, test, type Page } from "@playwright/test";

async function mockCustomResources(page: Page, scenario: "normal" | "paged" | "partial" | "replaced" | "many" | "adaptive" | "capped" | "duplicate" = "normal") {
  await page.addInitScript(scenario => {
    Object.assign(window, { isTauri: true, __customCalls: [], __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
      const request = args?.request;
      (window as any).__customCalls.push({ command, request });
      if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: ["file=/fixtures/config"], color: "#476BA1", status: "disconnected", pinned: false }] };
      if (command === "cluster_session_open") return { ...request, sessionId: "session-one", contextName: "dev", status: "disconnected", apiVersion: null, error: null };
      if (command === "cluster_connect") return { ...request, contextName: "dev", status: "connected", apiVersion: "v1.35", error: null };
      if (command === "cluster_pod_forward_list") return [];
      if (command === "cluster_resources") return { ...request, namespace: null, continueToken: null, metrics: null, truncated: false, fetchedAt: 1793000000000, items: [] };
      if (command === "cluster_custom_resource_definitions") {
        if (["many", "adaptive", "capped", "duplicate"].includes(scenario)) {
          const index = Number(request?.continueToken ?? 0);
          const size = scenario === "adaptive" ? 1 : scenario === "capped" ? 100 : 10;
          const total = scenario === "capped" ? 1_100 : scenario === "adaptive" ? 25 : 200;
          const next = index + size < total ? String(index + size) : null;
          return { ...request, kind: "customResourceDefinitions", namespace: null, continueToken: next, metrics: null, truncated: !!next, fetchedAt: 1793000000000,
            items: Array.from({ length: size }, (_, offset) => {
              const number = scenario === "duplicate" && index === 100 && offset === 0 ? 0 : index + offset;
              return { name: `widgets${number}.example.test`, uid: `definition-${index + offset}`, resourceVersion: null, namespace: null, status: "Unknown", createdAt: null,
                columns: { group: "example.test", kind: `Widget${number}`, plural: `widgets${number}`, scope: "Namespaced", versions: "v1" }, node: null };
            }) };
        }
        const second = request?.continueToken === "discovery-page-two";
        const name = second ? "gadgets.other.test" : "widgets.example.test";
        return { clusterId: request?.clusterId, sessionId: request?.sessionId, readId: request?.readId, kind: "customResourceDefinitions", namespace: null,
          continueToken: scenario === "paged" && !second ? "discovery-page-two" : null, metrics: null, truncated: scenario === "partial" || scenario === "paged" && !second, fetchedAt: 1793000000000,
          items: [{ name, uid: second ? "definition-two" : "definition-one", resourceVersion: null, namespace: null, status: "Unknown", createdAt: null,
            columns: { group: second ? "other.test" : "example.test", kind: second ? "Gadget" : "Widget", plural: second ? "gadgets" : "widgets", scope: second ? "Cluster" : "Namespaced", versions: "v1beta1,v1" }, node: null }] };
      }
      if (command === "cluster_custom_resources") {
        if (scenario === "replaced") throw "sourceChanged";
        const plural = String((request?.target as Record<string, unknown>)?.definitionName ?? "widgets.example.test").split(".")[0];
        return { ...request, group: "example.test", version: "v1", plural, kind: "Widget", namespaced: true,
          continueToken: scenario === "paged" && !request?.continueToken ? "instance-page-two" : null,
          truncated: scenario === "partial" || scenario === "paged" && !request?.continueToken,
          items: [{ name: request?.continueToken ? "second-widget" : "sample-widget", uid: request?.continueToken ? "widget-two" : "widget-one", namespace: request?.namespace ?? "default", createdAt: null, labelCount: 2 }] };
      }
      if (["cluster_disconnect", "cluster_resources_cancel", "cluster_custom_resources_cancel", "cluster_custom_resource_definitions_cancel"].includes(command)) return;
      throw new Error(`Unexpected IPC ${command}`);
    } } });
  }, scenario);
}

async function openWidget(page: Page) {
  await page.goto("/#/cluster/one?section=overview");
  const nav = page.getByRole("navigation", { name: "Cluster navigation", exact: true });
  await nav.getByRole("button", { name: "Expand Custom Resources", exact: true }).click();
  await expect(nav.getByRole("button", { name: "example.test", exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Widget", exact: true }).click();
  return nav;
}

test("discovered groups navigate to metadata-only custom resource lists", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await mockCustomResources(page);
  const nav = await openWidget(page);
  await expect(page.getByRole("table", { name: "Widget custom resources", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "sample-widget", exact: true })).toBeVisible();
  for (const name of ["Name", "Namespace", "Created", "Labels"]) await expect(page.getByRole("columnheader", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Widget", exact: true })).toHaveCount(0);
  await nav.getByRole("button", { name: "example.test", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("link", { name: "Widget", exact: true })).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(nav.getByRole("link", { name: "Widget", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("dedicated discovery follows pages without using generic table slots", async ({ page }) => {
  await mockCustomResources(page, "paged");
  const nav = await openWidget(page);
  await expect(nav.getByRole("button", { name: "other.test", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "sample-widget", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Next page", exact: true }).click();
  await expect(page.getByRole("cell", { name: "second-widget", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "sample-widget", exact: true })).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__customCalls as { command: string; request?: Record<string, unknown> }[]);
  const discovery = calls.filter(call => call.command === "cluster_custom_resource_definitions");
  expect(discovery.some(call => call.request?.continueToken === "discovery-page-two")).toBe(true);
  expect(discovery.every(call => Object.keys(call.request!).sort().join(",") === "clusterId,continueToken,readId,sessionId")).toBe(true);
  expect(calls.filter(call => call.command === "cluster_resources").every(call => call.request?.kind !== "customResourceDefinitions")).toBe(true);
  const read = calls.find(call => call.command === "cluster_custom_resources" && call.request?.continueToken === null)!;
  expect(calls).toContainEqual({ command: "cluster_custom_resources_cancel", request: read.request });
});

test("leaving a custom view cancels its exact instance and discovery scopes", async ({ page }) => {
  await mockCustomResources(page);
  await openWidget(page);
  await expect(page.getByRole("cell", { name: "sample-widget", exact: true })).toBeVisible();
  await page.goto("/#/catalog/all");
  await expect.poll(async () => page.evaluate(() => (window as any).__customCalls.filter((call: any) => call.command.endsWith("_cancel")).map((call: any) => call.command))).toEqual(expect.arrayContaining(["cluster_custom_resources_cancel", "cluster_custom_resource_definitions_cancel"]));
  const calls = await page.evaluate(() => (window as any).__customCalls as { command: string; request?: Record<string, unknown> }[]);
  for (const command of ["cluster_custom_resources", "cluster_custom_resource_definitions"]) {
    const last = calls.filter(call => call.command === command).at(-1)!;
    expect(calls).toContainEqual({ command: `${command}_cancel`, request: last.request });
  }
});

test("partial custom snapshots preserve the metadata rows and warn honestly", async ({ page }) => {
  await mockCustomResources(page, "partial");
  await openWidget(page);
  await expect(page.getByRole("cell", { name: "sample-widget", exact: true })).toBeVisible();
  await expect(page.getByText("This snapshot is partial. The response reached the engine limit.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Next page", exact: true })).toBeDisabled();
});

test("a replaced definition UID fails without showing instances", async ({ page }) => {
  await mockCustomResources(page, "replaced");
  await openWidget(page);
  await expect(page.getByText("Could not load Widget", { exact: true })).toBeVisible();
  await expect(page.getByText(/\(sourceChanged\)/)).toBeVisible();
  await expect(page.getByRole("table", { name: "Widget custom resources", exact: true })).toHaveCount(0);
  const reads = await page.evaluate(() => (window as any).__customCalls.filter((call: any) => call.command === "cluster_custom_resources"));
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every((call: any) => call.request.target.definitionUid === "definition-one")).toBe(true);
});

for (const scenario of ["many", "adaptive"] as const) {
  test(`${scenario} discovery resumes bounded batches from the omitted definition`, async ({ page }) => {
    await mockCustomResources(page, scenario);
    const target = scenario === "many" ? 150 : 24;
    await page.goto(`/#/cluster/one?section=custom-resource-instances&definition=widgets${target}.example.test`);
    const nav = page.getByRole("navigation", { name: "Cluster navigation", exact: true });
    const main = page.getByRole("main");
    await expect(main.getByText("The definition is not in the partial discovery result.", { exact: true })).toBeVisible();
    const initialReads = await page.evaluate(() => (window as any).__customCalls.filter((call: any) => call.command === "cluster_custom_resource_definitions").length);
    await main.getByRole("button", { name: "Load more definitions", exact: true }).click();
    if (scenario === "adaptive") {
      await expect(main.getByRole("button", { name: "Load more definitions", exact: true })).toBeVisible();
      await main.getByRole("button", { name: "Load more definitions", exact: true }).click();
    }
    await expect(page.getByRole("table", { name: `Widget${target} custom resources`, exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Widget0", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: `Widget${target}`, exact: true })).toBeVisible();
    const tokens = await page.evaluate(() => (window as any).__customCalls.filter((call: any) => call.command === "cluster_custom_resource_definitions").map((call: any) => call.request.continueToken));
    expect(tokens.slice(initialReads)).toEqual(Array.from({ length: scenario === "many" ? 10 : 15 }, (_, index) => String((index + 10) * (scenario === "many" ? 10 : 1))));
  });
}

test("sidebar continuation stops honestly at the global definition limit", async ({ page }) => {
  await mockCustomResources(page, "capped");
  await page.goto("/#/cluster/one?section=custom-resource-instances&definition=widgets999.example.test");
  await expect(page.getByRole("table", { name: "Widget999 custom resources", exact: true })).toBeVisible();
  await expect(page.getByText("Discovery is partial. 1000 definitions loaded. The 1,000-definition limit was reached.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more definitions", exact: true })).toHaveCount(0);
});

test("a repeated name with a replaced UID fails continuation instead of silently merging", async ({ page }) => {
  await mockCustomResources(page, "duplicate");
  await page.goto("/#/cluster/one?section=custom-resource-instances&definition=widgets150.example.test");
  await page.getByRole("main").getByRole("button", { name: "Load more definitions", exact: true }).click();
  await expect(page.getByText(/\(sourceChanged\)/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Widget0", exact: true })).toBeVisible();
});

test("instance continuation pauses automatic reads and both manual refresh paths reset to page one", async ({ page }) => {
  await mockCustomResources(page, "paged");
  await openWidget(page);
  await expect(page.getByRole("cell", { name: "sample-widget", exact: true })).toBeVisible();
  await page.clock.install();
  for (const keyboard of [false, true]) {
    await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Next page", exact: true }).click();
    await expect(page.getByRole("cell", { name: "second-widget", exact: true })).toBeVisible();
    const count = await page.evaluate(() => (window as any).__customCalls.filter((call: any) => call.command === "cluster_custom_resources").length);
    await page.clock.runFor(11_000);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect(await page.evaluate(() => (window as any).__customCalls.filter((call: any) => call.command === "cluster_custom_resources").length)).toBe(count);
    if (keyboard) await page.keyboard.press(process.platform === "darwin" ? "Meta+r" : "Control+r");
    else await page.getByRole("button", { name: "Refresh custom-resource-instances", exact: true }).click();
    await expect(page.getByRole("cell", { name: "sample-widget", exact: true })).toBeVisible();
    const token = await page.evaluate(() => (window as any).__customCalls.filter((call: any) => call.command === "cluster_custom_resources").at(-1).request.continueToken);
    expect(token).toBeNull();
  }
});

test("loading more sidebar definitions retains the selected UID instance snapshot", async ({ page }) => {
  await mockCustomResources(page, "many");
  await page.goto("/#/cluster/one?section=custom-resource-instances&definition=widgets0.example.test");
  await expect(page.getByRole("table", { name: "Widget0 custom resources", exact: true })).toBeVisible();
  const count = await page.evaluate(() => (window as any).__customCalls.filter((call: any) => call.command === "cluster_custom_resources").length);
  await page.getByRole("navigation", { name: "Cluster navigation", exact: true }).getByRole("button", { name: "Load more definitions", exact: true }).click();
  await expect(page.getByRole("link", { name: "Widget150", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Widget0 custom resources", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__customCalls.filter((call: any) => call.command === "cluster_custom_resources").length)).toBe(count);
});

test("a continuation scan deadline cancels its exact read and preserves prior definitions", async ({ page }) => {
  await mockCustomResources(page, "many");
  await page.addInitScript(() => {
    const original = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (command === "cluster_custom_resource_definitions" && args.request.continueToken === "100") {
        (window as any).__customCalls.push({ command, request: args.request });
        return new Promise(() => {});
      }
      return original(command, args);
    };
  });
  await page.goto("/#/cluster/one?section=custom-resource-instances&definition=widgets150.example.test");
  await expect(page.getByRole("link", { name: "Widget0", exact: true })).toBeVisible();
  await page.clock.install();
  await page.getByRole("main").getByRole("button", { name: "Load more definitions", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__customCalls.some((call: any) => call.command === "cluster_custom_resource_definitions" && call.request.continueToken === "100"))).toBe(true);
  await page.clock.runFor(5_100);
  await expect(page.getByText(/\(timeout\)/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Widget0", exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__customCalls);
  const last = calls.filter((call: any) => call.command === "cluster_custom_resource_definitions").at(-1);
  expect(calls).toContainEqual({ command: "cluster_custom_resource_definitions_cancel", request: last.request });
});
