import { expect, test, type Page } from "@playwright/test";

type Request = Record<string, string | number | null | undefined>;
type Call = { command: string; request: Request };
type Controls = {
  namespaceFailure?: string;
  namespaceEmpty?: boolean;
  namespacePages?: boolean;
  namespaceCap?: boolean;
  namespaceDuplicate?: boolean;
  namespaceRepeatedToken?: boolean;
  namespaceInvalid?: boolean;
  holdNamespaces?: boolean;
  holdPods?: boolean;
  namespaceNames?: string[];
  clusters?: "one" | "two";
};
type MockWindow = Window & {
  __namespaceCalls: Call[];
  __namespaceControls: Controls;
  __releaseNamespaces: () => void;
  __releasePods: () => void;
};

const route = (cluster = "one", section = "pods") => `/#/cluster/${cluster}?section=${section}`;
const calls = (page: Page, kind?: string) => page.evaluate((kind) => (window as MockWindow).__namespaceCalls.filter((call) =>
  call.command === "cluster_resources" && (!kind || call.request.kind === kind)), kind);
const selector = (page: Page) => page.getByRole("button", { name: /^Namespace(?:\s|$)/ });

test("the actual Namespaces page does not cancel its read when the selector cache completes late", async ({ page }) => {
  await fixture(page, { holdNamespaces: true }); await expect(selector(page)).toBeVisible();
  await expect.poll(async () => (await calls(page, "namespaces")).length).toBe(1);
  const cacheRead = (await calls(page, "namespaces"))[0].request;
  await page.evaluate(() => { location.hash = "/cluster/one?section=namespaces"; });
  await expect.poll(async () => (await calls(page, "namespaces")).length).toBeGreaterThanOrEqual(2);
  const viewRead = (await calls(page, "namespaces")).at(-1)!.request;
  expect(viewRead.readId).not.toBe(cacheRead.readId);
  await page.evaluate(() => (window as MockWindow).__releaseNamespaces());
  await expect(page.getByRole("table", { name: "Namespaces", exact: true })).toContainText("production");
  const cancels = await page.evaluate(() => (window as MockWindow).__namespaceCalls.filter((call) => call.command === "cluster_resources_cancel"));
  expect(cancels).toContainEqual({ command: "cluster_resources_cancel", request: cacheRead });
  expect(cancels.some((call) => call.request.readId === viewRead.readId)).toBe(false);
});

test("a replacement session on the same cluster starts a fresh namespace cache", async ({ page }) => {
  await fixture(page); await connected(page);
  const old = (await calls(page, "namespaces"))[0].request;
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
  await expect(selector(page)).toHaveCount(0);
  await page.evaluate(() => { (window as MockWindow).__namespaceControls.namespaceNames = ["new-session-only"]; });
  await clusterAction(page, "Refresh pods");
  await connected(page);
  const current = (await calls(page, "namespaces")).at(-1)!.request;
  expect(current.sessionId).not.toBe(old.sessionId);
  await selector(page).click();
  await expect(page.getByRole("option")).toHaveText(["All namespaces", "new-session-only"]);
});

async function fixture(page: Page, controls: Controls = {}, cluster = "one", section = "pods") {
  page.on("pageerror", (error) => { throw error; });
  await page.addInitScript(({ controls }) => {
    const calls: Call[] = [];
    const control = { ...controls };
    const namespaceWaiters: (() => void)[] = [];
    const podWaiters: (() => void)[] = [];
    let lease = 0;
    const namespaces = ["default", "kube-system", "production", "team-a", "team-b"];
    const clusters = [
      { id: "one", name: "Development", contextName: "dev", color: "#476BA1" },
      { id: "two", name: "Staging", contextName: "staging", color: "#8B5E3C" },
    ];
    const release = (waiters: (() => void)[]) => waiters.splice(0).forEach((resolve) => resolve());
    Object.assign(window, {
      isTauri: true,
      __namespaceCalls: calls,
      __namespaceControls: control,
      __releaseNamespaces: () => release(namespaceWaiters),
      __releasePods: () => release(podWaiters),
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: { request: Request }) => {
          const request = { ...args?.request };
          calls.push({ command, request });
          if (command === "catalog_list") return {
            revision: 1, discoveryError: null, webLinks: [], clusters: clusters
              .filter((item) => control.clusters === "two" ? true : item.id === "one")
              .map((item) => ({ ...item, source: "kubeconfig", labels: [], pinned: false, status: "disconnected" })),
          };
          if (command === "cluster_session_open" || command === "cluster_connect") {
            const id = String(request.clusterId);
            return { clusterId: id, sessionId: request.sessionId ?? `${id}-lease-${++lease}`, contextName: id === "two" ? "staging" : "dev",
              status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
          }
          if (command === "cluster_disconnect" || command === "cluster_resources_cancel") return;
          if (command === "helm_cancel") return;
          if (command === "helm_table") return { ...request, namespace: request.namespace ?? null, truncated: false, items: [] };
          if (command !== "cluster_resources") throw `Unexpected mock command: ${command}`;
          if (request.kind === "namespaces") {
            const oldCluster = request.clusterId;
            if (control.holdNamespaces) await new Promise<void>((resolve) => namespaceWaiters.push(resolve));
            if (control.namespaceFailure) throw control.namespaceFailure;
            if (control.namespaceDuplicate) return namespacePage(request, ["team-a", "team-a"], null, false);
            if (control.namespaceInvalid) return namespacePage(request, ["Not_A_Namespace"], null, false);
            if (control.namespaceRepeatedToken) return namespacePage(request, [request.continueToken ? "team-b" : "team-a"], "repeated", true);
            if (control.namespaceEmpty) return namespacePage(request, [], null, false);
            if (control.namespaceCap) {
              const index = Number(request.continueToken ?? 0);
              const page = Array.from({ length: 100 }, (_, offset) => `ns-${String(index * 100 + offset).padStart(4, "0")}`);
              return namespacePage(request, page, String(index + 1), true);
            }
            if (control.namespacePages) {
              return request.continueToken
                ? namespacePage(request, ["team-c", "team-d"], null, false)
                : namespacePage(request, ["team-b", "team-a"], "page-2", true);
            }
            return namespacePage(request, control.namespaceNames ?? (oldCluster === "two" ? ["staging-only"] : namespaces), null, false);
          }
          if (request.kind === "pods") {
            if (control.holdPods) await new Promise<void>((resolve) => podWaiters.push(resolve));
            const result = resourcePage(request, request.namespace ? [`${request.namespace}-pod`] : [request.continueToken ? "next-pod" : "all-pod"]);
            if (!request.continueToken) { result.continueToken = "pods-next"; result.truncated = true; }
            return result;
          }
          if (request.kind === "services") return resourcePage(request, ["service-one"]);
          if (request.kind === "deployments") return resourcePage(request, ["deployment-one"]);
          throw `Unexpected resource kind: ${request.kind}`;
        },
      },
    });
    function namespacePage(request: Request, names: string[], token: string | null, truncated: boolean) {
      return { ...request, namespace: null, continueToken: token, truncated, fetchedAt: Date.now(), metrics: null,
        items: names.map((name) => ({ name, namespace: null, status: "Active", createdAt: null, columns: {}, node: null })) };
    }
    function resourcePage(request: Request, names: string[]) {
      return { ...request, namespace: request.namespace ?? null, continueToken: null as string | null, truncated: false, fetchedAt: Date.now(), metrics: null,
        items: names.map((name) => ({ name, namespace: request.namespace ?? "team-a", status: "Running", createdAt: null, columns: {}, node: null })) };
    }
  }, { controls });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(route(cluster, section));
  await expect(page.getByRole("switch", { name: "Resource tables", exact: true })).toHaveCount(0);
}

async function connected(page: Page) {
  await expect(page.getByRole("table", { name: "Pods", exact: true })).toBeVisible();
  await expect(page.getByText("Loading namespaces…", { exact: true })).toHaveCount(0);
}
async function choose(page: Page, name: string) {
  await expect(selector(page)).toBeVisible();
  await selector(page).click();
  await page.getByRole("option", { name, exact: true }).click();
}

test("fetches namespaces immediately for Pods and exposes a searchable accessible selector", async ({ page }) => {
  await fixture(page); await connected(page);
  await clusterAction(page, "Next page");
  await expect(page.getByRole("table", { name: "Pods", exact: true })).toContainText("next-pod");
  expect(await calls(page, "namespaces")).toHaveLength(1);
  await selector(page).click();
  await expect(page.getByRole("combobox", { name: "Search" })).toBeVisible();
  await page.getByRole("combobox", { name: "Search" }).fill("prod");
  await expect(page.getByRole("option", { name: "production", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "team-a", exact: true })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "All namespaces", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Namespace", exact: true })).toHaveCount(0);
});

test("sorts options and selecting one immediately scopes the server request and resets continuation", async ({ page }) => {
  await fixture(page); await connected(page);
  await choose(page, "team-a");
  await expect(page.getByRole("table", { name: "Pods", exact: true })).toContainText("team-a-pod");
  const podReads = await calls(page, "pods");
  expect(podReads.at(-1)!.request).toMatchObject({ namespace: "team-a", continueToken: null });
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Previous page", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(selector(page)).toContainText("team-a");
  await selector(page).click();
  const options = await page.getByRole("option").allTextContents();
  expect(options).toEqual(["All namespaces", "default", "kube-system", "production", "team-a", "team-b"]);
});

test("does not restore the retired Resource tables switch or use its localStorage preference", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("icekube.resource-tables.v1", "false"));
  await fixture(page); await connected(page);
  await expect(page.getByRole("switch", { name: "Resource tables", exact: true })).toHaveCount(0);
  expect(await calls(page, "namespaces")).toHaveLength(1);
});

test("reuses one namespace lease while navigating Pods, Services, Helm releases, and back", async ({ page }) => {
  await fixture(page); await connected(page);
  const initial = await calls(page, "namespaces");
  for (const section of ["services", "helm-releases", "pods"]) {
    await page.evaluate((next) => { location.hash = `/cluster/one?section=${next}`; }, section);
    await expect(page.getByRole("table", { name: section === "helm-releases" ? "Helm Releases" : section === "services" ? "Services" : "Pods", exact: true })).toBeVisible();
  }
  expect(await calls(page, "namespaces")).toEqual(initial);
});

test("does not let a late namespace response from an old cluster populate the new workspace", async ({ page }) => {
  await fixture(page, { holdNamespaces: true, clusters: "two" }); await expect(selector(page)).toBeVisible();
  await expect.poll(async () => (await calls(page, "namespaces")).length).toBe(1);
  const old = (await calls(page, "namespaces"))[0].request;
  await page.evaluate(() => { (window as MockWindow).__namespaceControls.holdNamespaces = false; });
  await page.evaluate(() => { location.hash = "/cluster/two?section=pods"; });
  await expect(page.getByRole("table", { name: "Pods", exact: true })).toBeVisible();
  await expect.poll(async () => (await calls(page, "namespaces")).some((call) => call.request.clusterId === "two")).toBe(true);
  await page.evaluate(() => (window as MockWindow).__releaseNamespaces());
  await expect(page.getByText("Loading namespaces…", { exact: true })).toHaveCount(0);
  await selector(page).click();
  await expect(page.getByRole("option", { name: "staging-only", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "production", exact: true })).toHaveCount(0);
  expect((await calls(page, "namespaces")).at(-1)!.request.sessionId).not.toBe(old.sessionId);
});

test("cancels the exact pending namespace read on disposal and ignores its late result", async ({ page }) => {
  await fixture(page, { holdNamespaces: true }); await expect(selector(page)).toBeVisible();
  await expect.poll(async () => (await calls(page, "namespaces")).length).toBe(1);
  const pending = (await calls(page, "namespaces")).at(-1)!.request;
  await page.evaluate(() => { location.hash = "/catalog"; });
  await expect.poll(async () => (await page.evaluate(() => (window as MockWindow).__namespaceCalls.filter((call) => call.command === "cluster_resources_cancel")))).toContainEqual({
    command: "cluster_resources_cancel", request: pending,
  });
  await page.evaluate(() => (window as MockWindow).__releaseNamespaces());
  await expect(selector(page)).toHaveCount(0);
  await expect(page.getByRole("option", { name: "team-a", exact: true })).toHaveCount(0);
});

test("permission denied keeps All namespaces usable, offers retry, and retry succeeds", async ({ page }) => {
  await fixture(page, { namespaceFailure: "permissionDenied" }); await connected(page);
  await expect(page.getByText(/Could not load namespaces/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry namespaces", exact: true })).toBeVisible();
  await choose(page, "All namespaces");
  expect((await calls(page, "pods")).at(-1)!.request).toMatchObject({ namespace: null });
  await expect(page.getByRole("table", { name: "Pods", exact: true })).toContainText("all-pod");
  await page.evaluate(() => { (window as MockWindow).__namespaceControls.namespaceFailure = undefined; });
  await page.getByRole("button", { name: "Retry namespaces", exact: true }).click();
  await expect(page.getByText(/Could not load namespaces/)).toHaveCount(0);
  await expect(page.getByText("No namespaces were returned.", { exact: true })).toHaveCount(0);
  expect(await calls(page, "namespaces")).toHaveLength(2);
  await choose(page, "production");
  await expect(page.getByRole("table", { name: "Pods", exact: true })).toContainText("production-pod");
});

test("reports an empty namespace response honestly without fabricating options", async ({ page }) => {
  await fixture(page, { namespaceEmpty: true }); await connected(page);
  await expect(page.getByText("No namespaces were returned.", { exact: true })).toBeVisible();
  await selector(page).click();
  await expect(page.getByRole("option", { name: "All namespaces", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "team-a", exact: true })).toHaveCount(0);
});

test("follows both namespace pages before exposing the sorted complete list", async ({ page }) => {
  await fixture(page, { namespacePages: true }); await connected(page);
  expect(await calls(page, "namespaces")).toHaveLength(2);
  await selector(page).click();
  await expect(page.getByRole("option", { name: "team-d", exact: true })).toBeVisible();
  await expect(page.getByText(/namespace list is partial/)).toHaveCount(0);
  expect((await calls(page, "namespaces"))[1].request).toMatchObject({ continueToken: "page-2" });
  await expect(page.getByRole("option")).toHaveText(["All namespaces", "team-a", "team-b", "team-c", "team-d"]);
});

test("caps namespace pagination at ten pages and 1000 names with an honest partial status", async ({ page }) => {
  await fixture(page, { namespaceCap: true }); await connected(page);
  expect(await calls(page, "namespaces")).toHaveLength(10);
  await expect(page.getByText(/namespace list is partial/)).toBeVisible();

  await selector(page).click();
  await expect(page.getByRole("option", { name: "ns-0999", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "ns-1000", exact: true })).toHaveCount(0);
});

test("namespace navigation does not cancel the current view's async resource read incorrectly", async ({ page }) => {
  await fixture(page, { holdPods: true }); await expect(selector(page)).toBeVisible();
  await expect(page.getByText("Loading namespaces…", { exact: true })).toHaveCount(0);
  await choose(page, "team-a");
  const podRequest = (await calls(page, "pods")).at(-1)!.request;
  await choose(page, "team-b");
  const cancels = await page.evaluate(() => (window as MockWindow).__namespaceCalls.filter((call) => call.command === "cluster_resources_cancel"));
  expect(cancels.some((call) => call.request.readId === podRequest.readId && call.request.namespace === "team-a")).toBe(true);
  await page.evaluate(() => (window as MockWindow).__releasePods());
  await expect(selector(page)).toContainText("team-b");
  expect((await calls(page, "pods")).at(-1)!.request).toMatchObject({ namespace: "team-b" });
});

for (const malformed of ["namespaceDuplicate", "namespaceInvalid", "namespaceRepeatedToken"] as const) {
  test(`fails closed for ${malformed} instead of showing a partial invented namespace list`, async ({ page }) => {
    await fixture(page, { [malformed]: true }); await connected(page);
    await expect(page.getByRole("status").filter({ hasText: "Could not load namespaces" })).toContainText("unsupported response");
    await selector(page).click();
    await expect(page.getByRole("option")).toHaveText(["All namespaces"]);
    expect(await calls(page, "namespaces")).toHaveLength(malformed === "namespaceRepeatedToken" ? 2 : 1);
    await expect(page.getByRole("table", { name: "Pods", exact: true })).toContainText("all-pod");
  });
}

async function clusterAction(page: Page, name: string) {
  await page.getByRole("button", { name: "Cluster actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
