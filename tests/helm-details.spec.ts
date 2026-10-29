import { expect, test, type Page } from "@playwright/test";

type Request = Record<string, unknown>;
type Fixture = Window & { __detailCalls: { command: string; request: Request }[]; __detailFailure: boolean; __detailMismatch: boolean; __detailHold: boolean; __detailRelease: () => void };
async function fixture(page: Page, view = "charts") {
  await page.addInitScript(() => {
    const calls: { command: string; request: Request }[] = [];
    const pending: (() => void)[] = [];
    const w = window as Fixture;
    Object.assign(window, { isTauri: true, __detailCalls: calls, __detailRelease: () => { w.__detailHold = false; pending.splice(0).forEach(resolve => resolve()); },
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Request }) => {
        const r = { ...args?.request }; calls.push({ command, request: r });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
        if (command === "preferences_get") return null;
        if (command === "update_state") return { phase: "idle", version: null, error: null };
        if (command === "cluster_permissions_review") return { clusterId: r.clusterId, sessionId: r.sessionId, readId: r.readId, authorizationEpoch: `fixture-${r.sessionId}`, revision: r.readId, checkedAt: Date.now(), expiresAt: Date.now() + 30_000,
          items: (r.checks as unknown[]).map(check => ({ check, decision: "allowed", reason: null })) };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: r.clusterId, sessionId: r.sessionId ?? "lease-1", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        if (command === "cluster_resources") return { ...r, namespace: null, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null, items: [] };
        if (command.endsWith("_cancel") || command === "cluster_disconnect" || command === "cluster_permissions_refresh") return null;
        if (command === "helm_table") return { ...r, truncated: false, items: [{ id: "demo", name: r.view === "charts" ? "stable/demo" : "demo", namespace: r.view === "charts" ? null : "team-a", version: r.view === "charts" ? "1.0.0" : "demo-1.0.0", appVersion: "1", description: r.view === "charts" ? "Cached chart" : null, status: r.view === "charts" ? null : "deployed", revision: r.view === "charts" ? null : 2, updated: r.view === "charts" ? null : "today" }] };
        if (command === "helm_detail") {
          const mismatch = w.__detailMismatch, failure = w.__detailFailure;
          if (w.__detailHold) await new Promise<void>(resolve => pending.push(resolve));
          if (failure) throw "raw diagnostic private-fixture";
          return { ...r, name: mismatch ? "other" : r.name, truncated: false,
            facts: r.view === "charts" ? [{ label: "Description", value: "Chart metadata from repository" }, { label: "Maintainer", value: "Chart team" }] : [],
            history: r.view === "releases" ? [{ revision: 2, updated: "today", status: "deployed", chart: "demo-1.0.0", appVersion: "1" }] : [] };
        }
        throw `Unexpected command ${command}`;
      } },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/#/cluster/one?section=helm-${view}`);
  await expect(page.getByRole("button", { name: view === "charts" ? "stable/demo" : "demo", exact: true })).toBeVisible();
}
const details = (page: Page) => page.getByLabel("Resource details", { exact: true });
for (const view of ["charts", "releases"]) test(`${view}: opens real scoped details instead of summary`, async ({ page }) => {
  await fixture(page, view);
  await page.getByRole("button", { name: view === "charts" ? "stable/demo" : "demo", exact: true }).click();
  await expect(details(page)).toContainText(view === "charts" ? "Chart metadata from repository" : "Revision history");
  if (view === "releases") await expect(details(page)).toContainText("Values, manifests, notes and revision descriptions are withheld");
  expect(await page.evaluate(() => (window as Fixture).__detailCalls.filter(call => call.command === "helm_detail").map(call => call.request))).toEqual([
    { clusterId: "one", sessionId: "lease-1", view, name: view === "charts" ? "stable/demo" : "demo", namespace: view === "charts" ? null : "team-a", version: view === "charts" ? "1.0.0" : null, readId: expect.any(Number) },
  ]);
});
for (const mismatch of [false, true]) test(`${mismatch ? "mismatch" : "sanitized failure"} does not display untrusted result`, async ({ page }) => {
  await fixture(page);
  await page.evaluate(mismatch => { const w = window as Fixture; w.__detailMismatch = mismatch; w.__detailFailure = !mismatch; }, mismatch);
  await page.getByRole("button", { name: "stable/demo", exact: true }).click();
  await expect(details(page).getByRole("alert")).toBeVisible();
  await expect(details(page)).not.toContainText("private-fixture");
  await expect(details(page)).not.toContainText("Chart metadata from repository");
});
test("closing pending details cancels the exact read and ignores late result", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { (window as Fixture).__detailHold = true; });
  await page.getByRole("button", { name: "stable/demo", exact: true }).click();
  await expect(details(page)).toContainText("Loading Helm details");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => (window as Fixture).__detailCalls.filter(call => call.command === "helm_detail_cancel").length)).toBe(1);
  await page.evaluate(() => (window as Fixture).__detailRelease());
  await expect(details(page)).toHaveCount(0);
});
