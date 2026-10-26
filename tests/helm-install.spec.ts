import { expect, test, type Page } from "@playwright/test";

type Request = Record<string, string | number | boolean | null>;
type Call = { command: string; request: Request };
type Controls = { hold?: boolean; failure?: string; malformed?: string };
type FixtureWindow = Window & { __helmCalls: Call[]; __helmControls: Controls; __releaseHelm: () => void; __unexpectedHelm: string[] };
const calls = (page: Page, command = "helm_install") => page.evaluate(command => (window as FixtureWindow).__helmCalls.filter(call => call.command === command), command);
const control = (page: Page, controls: Controls) => page.evaluate(controls => Object.assign((window as FixtureWindow).__helmControls, controls), controls);
const dialog = (page: Page) => page.getByRole("dialog");
async function fixture(page: Page, view = "charts") {
  await page.addInitScript(() => {
    const calls: Call[] = [], pending: (() => void)[] = [], unexpected: string[] = [];
    const controls: Controls = {};
    Object.assign(window, { isTauri: true, __helmCalls: calls, __helmControls: controls, __unexpectedHelm: unexpected,
      __releaseHelm: () => { controls.hold = false; pending.splice(0).forEach(resolve => resolve()); },
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Request }) => {
        const r = { ...args?.request }; calls.push({ command, request: r });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "update_state") return { phase: "idle", version: null, error: null };
        if (command === "preferences_get") return null;
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: r.clusterId, sessionId: r.sessionId ?? "lease-1", contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        if (["cluster_disconnect", "cluster_resources_cancel", "helm_cancel", "helm_install_cancel"].includes(command)) return null;
        if (command === "cluster_resources") return { ...r, namespace: null, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null,
          items: ["team-a", "team-b"].map(name => ({ name, namespace: null, status: "Active", createdAt: null, columns: {}, node: null })) };
        if (command === "helm_table") return { ...r, truncated: false, items: r.view === "charts" ? [{ id: "cached", name: "stable/demo", namespace: null,
          version: "1.0.0", appVersion: "1", description: "Cached chart", status: null, revision: null, updated: null }] : [] };
        if (command === "helm_install") {
          const options = { ...controls };
          if (options.hold) await new Promise<void>(resolve => pending.push(resolve));
          if (options.failure) throw options.failure;
          const result: Request = { clusterId: r.clusterId, sessionId: r.sessionId, namespace: r.namespace, releaseName: r.releaseName, chart: r.chart, created: !r.dryRun };
          if (options.malformed === "created") result.created = r.dryRun;
          else if (options.malformed) result[options.malformed] = "other";
          return result;
        }
        unexpected.push(command); throw "Unexpected fixture command";
      } },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/#/cluster/one?section=helm-${view}`);
  await expect(page.getByRole("button", { name: "Install Helm chart", exact: true })).toBeEnabled();
}
async function open(page: Page) {
  await page.getByRole("button", { name: "Install Helm chart", exact: true }).click();
  await expect(dialog(page).getByRole("textbox", { name: "Release name", exact: true })).toBeVisible();
}
async function fill(page: Page) {
  await dialog(page).getByRole("button", { name: /^Namespace/ }).click();
  await page.getByRole("option", { name: "team-a", exact: true }).click();
  await dialog(page).getByRole("textbox", { name: "Release name", exact: true }).fill("sample");
  await dialog(page).getByRole("textbox", { name: "Chart repository/name", exact: true }).fill("stable/demo");
}
const dryRun = (page: Page) => dialog(page).getByRole("button", { name: "Run server dry-run", exact: true }).click();
test.afterEach(async ({ page }) => { expect(await page.evaluate(() => (window as FixtureWindow).__unexpectedHelm ?? [])).toEqual([]); });
for (const view of ["charts", "releases"]) test(`${view}: enabled FAB, explicit namespace, dry-run then confirmation and install refresh`, async ({ page }) => {
  await fixture(page, view); await open(page);
  await expect(dialog(page).getByRole("button", { name: "Run server dry-run", exact: true })).toBeDisabled();
  await expect(dialog(page).getByRole("textbox", { name: "Values YAML", exact: true })).toHaveText("{}\n");
  await fill(page);
  const values = "privateFixture: synthetic-secret-9x\n";
  await dialog(page).getByRole("textbox", { name: "Values YAML", exact: true }).fill(values);
  await dialog(page).getByRole("textbox", { name: "Chart version (optional)", exact: true }).fill("1.2.3");
  await dryRun(page);
  await expect(dialog(page)).toContainText("Server dry-run passed");
  for (const text of ["Cluster: Development", "Context: dev", "Namespace: team-a", "Release: sample", "Chart: stable/demo", "Version: 1.2.3"]) await expect(dialog(page)).toContainText(text);
  await expect(dialog(page)).not.toContainText("synthetic-secret-9x");
  expect(await calls(page)).toHaveLength(1);
  const reads = (await calls(page, "helm_table")).length;
  await dialog(page).getByRole("button", { name: "Install release", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const requests = (await calls(page)).map(call => call.request);
  expect(requests[0]).toEqual({ clusterId: "one", sessionId: "lease-1", readId: expect.any(Number), namespace: "team-a", releaseName: "sample", chart: "stable/demo", version: "1.2.3", valuesYaml: values, dryRun: true });
  expect(requests[1]).toEqual({ ...requests[0], readId: expect.any(Number), dryRun: false });
  expect(requests[1].readId).toBeGreaterThan(requests[0].readId as number);
  await expect.poll(async () => (await calls(page, "helm_table")).length).toBe(reads + 1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("synthetic-secret-9x");
});
for (const [field, value, message] of [
  ["Release name", "X".repeat(54), "53 characters"], ["Chart repository/name", "https://charts.test/demo", "repository/name"],
  ["Chart repository/name", "../chart", "repository/name"], ["Chart repository/name", "/tmp/chart", "repository/name"],
  ["Chart version (optional)", "--help", "valid chart version"], ["Values YAML", "é".repeat(132000), "256 KiB"],
]) test(`reject invalid ${field} ${value.slice(0, 25)} before IPC`, async ({ page }) => {
  await fixture(page); await open(page); await fill(page);
  await dialog(page).getByRole("textbox", { name: field, exact: true }).fill(value); await dryRun(page);
  await expect(dialog(page).getByRole("alert")).toContainText(message);
  expect(await calls(page)).toEqual([]);
});
test("editing invalidates dry-run and retains values", async ({ page }) => {
  await fixture(page); await open(page); await fill(page); await dryRun(page);
  await dialog(page).getByRole("button", { name: "Edit installation", exact: true }).click();
  await expect(dialog(page).getByRole("button", { name: "Install release", exact: true })).toHaveCount(0);
  await dialog(page).getByRole("textbox", { name: "Release name", exact: true }).fill("changed");
  await dryRun(page); await expect(dialog(page)).toContainText("Release: changed");
  expect((await calls(page)).map(call => call.request.dryRun)).toEqual([true, true]);
});
for (const malformed of ["clusterId", "sessionId", "namespace", "releaseName", "chart", "created"]) test(`reject mismatched ${malformed}`, async ({ page }) => {
  await fixture(page); await control(page, { malformed }); await open(page); await fill(page); await dryRun(page);
  await expect(dialog(page).getByRole("alert")).toContainText("unsupported response");
  await expect(dialog(page).getByRole("textbox", { name: "Values YAML", exact: true })).toHaveText("{}\n");
  expect((await calls(page)).map(call => call.request.dryRun)).toEqual([true]);
});
for (const post of [false, true]) test(`${post ? "install" : "dry-run"} sanitized failure and uncertainty`, async ({ page }) => {
  await fixture(page); await open(page); await fill(page);
  if (post) { await dryRun(page); await expect(dialog(page)).toContainText("Server dry-run passed"); }
  await control(page, { failure: "raw diagnostic synthetic-secret-9x" });
  if (post) await dialog(page).getByRole("button", { name: "Install release", exact: true }).click();
  else await dryRun(page);
  await expect(dialog(page).getByRole("alert")).toBeVisible();
  await expect(dialog(page)).not.toContainText("synthetic-secret-9x");
  if (post) await expect(dialog(page)).toContainText("Installation may already have reached");
  expect((await calls(page)).map(call => call.request.dryRun)).toEqual(post ? [true, false] : [true]);
});
for (const disposal of ["cancel", "escape", "route", "namespace"]) test(`${disposal}: exact cancellation rejects late dry-run`, async ({ page }) => {
  await fixture(page); await open(page); await fill(page); await control(page, { hold: true }); await dryRun(page);
  const request = (await calls(page))[0].request;
  if (disposal === "cancel") await dialog(page).getByRole("button", { name: "Cancel request", exact: true }).click();
  if (disposal === "escape") await page.keyboard.press("Escape");
  if (disposal === "route") await page.evaluate(() => { location.hash = "/cluster/one?section=helm-releases"; });
  if (disposal === "namespace") {
    await dialog(page).getByRole("button", { name: /^Namespace/ }).click();
    await page.getByRole("option", { name: "team-b", exact: true }).click();
  }
  await expect.poll(async () => (await calls(page, "helm_install_cancel")).map(call => call.request)).toEqual([{ clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId }]);
  await page.evaluate(() => (window as FixtureWindow).__releaseHelm());
  await expect(page.getByRole("button", { name: "Install release", exact: true })).toHaveCount(0);
  expect(await calls(page)).toHaveLength(1);
});
for (const post of [false, true]) test(`${post ? "install" : "dry-run"} ignores duplicate pending activation`, async ({ page }) => {
  await fixture(page); await open(page); await fill(page);
  if (post) { await dryRun(page); await expect(dialog(page)).toContainText("Server dry-run passed"); }
  await control(page, { hold: true });
  await dialog(page).getByRole("button", { name: post ? "Install release" : "Run server dry-run", exact: true }).evaluate(node => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true })); node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect.poll(async () => (await calls(page)).length).toBe(post ? 2 : 1);
  await dialog(page).getByRole("button", { name: "Cancel request", exact: true }).click();
  if (post) await expect(page.getByRole("status").filter({ hasText: "Installation may already have reached" })).toBeVisible();
  await page.evaluate(() => (window as FixtureWindow).__releaseHelm());
  await expect(dialog(page)).toHaveCount(0);
});
