import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, kind = "deployments", namespace: string | null = "team-a", uid: string | null = "parent-uid") {
  await page.route("**/src/app/cluster/ResourceInspector.tsx*", route => route.fulfill({ contentType: "text/javascript", body: `export function useResourceInspector() { return { navigateResource(reference) { window.navigated.push(reference); } }; }` }));
  await page.route("**/__detail_collections", route => route.fulfill({ contentType: "text/html", body: `<html><body><main id="root"></main><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import {DetailCollections} from '/src/app/cluster/DetailCollections.tsx';
    import '/node_modules/@astryxdesign/core/src/reset.css?import';
    import '/node_modules/@astryxdesign/core/dist/astryx.css?import';
    const root = ReactDOM.createRoot(document.getElementById('root'));
    window.renderCollections = (props) => root.render(React.createElement(DetailCollections, props));
    window.closeCollections = () => root.render(null);
    window.renderCollections(${JSON.stringify({ clusterId: "cluster-a", sessionId: "session-a", reference: { kind, namespace, name: "parent", uid }, revision: 0 })});
  </script></body></html>` }));
  await page.addInitScript(() => {
    const w = window as any;
    w.calls = []; w.navigated = []; w.controls = {}; w.releases = [];
    w.__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      const request = structuredClone(args.request);
      w.calls.push({ command, request });
      if (command.endsWith("_cancel")) return null;
      const control = { ...(w.controls[request.collection] ?? {}) };
      if (control.hold) await new Promise(resolve => w.releases.push(resolve));
      if (control.fail) throw "network";
      const state = control.state ?? "complete";
      const columns = request.collection === "pods" ? { ready: "1/1", node: control.node ?? "worker-1.example.test" }
        : request.collection === "events" ? { type: "Warning", message: "Failed to schedule pod", source: "scheduler", count: "3", lastSeen: "2026-10-29T10:00:00Z" }
        : request.collection === "endpointSlices" ? { addressType: "IPv4", endpoints: "2", ports: "443/TCP" } : {};
      return { ...request, state, items: state === "denied" || state === "unavailable" || control.empty ? [] : [{ reference: { kind: request.collection, namespace: request.reference.kind === "namespaces" ? request.reference.name : request.reference.namespace ?? "team-a", name: `${request.collection}-${control.suffix ?? "one"}`, uid: `${request.collection}-uid` }, status: request.collection === "events" ? "Warning" : "Running", columns }] };
    } };
    w.isTauri = true;
  });
  await page.goto("/__detail_collections");
  await page.waitForFunction(() => typeof (window as any).renderCollections === "function");
}
async function rerender(page: Page, revision = 1, sessionId = "session-a", kind = "deployments", uid = "parent-uid") {
  await page.evaluate(props => (window as any).renderCollections(props), { clusterId: "cluster-a", sessionId, reference: { kind, namespace: "team-a", name: "parent", uid }, revision });
}

test("independent tables navigate exact typed identities and cancel every exact read on close", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("table")).toHaveCount(3);
  await page.getByRole("button", { name: "replicaSets-one", exact: true }).click();
  expect(await page.evaluate(() => (window as any).navigated)).toEqual([{ kind: "replicaSets", namespace: "team-a", name: "replicaSets-one", uid: "replicaSets-uid" }]);
  await page.evaluate(() => (window as any).closeCollections());
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as any).calls;
    return calls.filter((c: any) => c.command.endsWith("_cancel")).map((c: any) => c.request);
  })).toEqual(await page.evaluate(() => (window as any).calls.filter((c: any) => c.command === "cluster_resource_collection").map((c: any) => c.request)));
});

test("partial, denied and unavailable sections stay independent", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { (window as any).controls = { pods: { state: "partial" }, replicaSets: { state: "denied" }, events: { state: "unavailable" } }; });
  await rerender(page);
  await expect(page.getByText("Some related resources could not be read.")).toBeVisible();
  await expect(page.getByText("Permission denied for this related collection.")).toBeVisible();
  await expect(page.getByText("The cluster did not provide this related collection.")).toBeVisible();
  await expect(page.getByRole("button", { name: "pods-one", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(1);
  await expect(page.getByText("Pods Status (returned subset, partial): Running: 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(2);
  await page.evaluate(() => { (window as any).controls.replicaSets = {}; });
  const section = page.locator('[aria-label="Replica Sets related resources"]');
  await section.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(section.getByRole("table")).toBeVisible();
  expect(await page.evaluate(() => (window as any).calls.filter((call: any) => call.command === "cluster_resource_collection").slice(-1).map((call: any) => call.request.collection))).toEqual(["replicaSets"]);
});

test("refresh retains stale results on failure, retry is collection-local, and old session promises cannot navigate", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("table")).toHaveCount(3);
  await page.evaluate(() => { (window as any).controls = { pods: { fail: true }, events: { hold: true, suffix: "old" } }; });
  await rerender(page);
  await expect(page.getByText(/Retained results may be stale/)).toBeVisible();
  await expect(page.getByRole("button", { name: "pods-one", exact: true })).toBeDisabled();
  await expect(page.getByRole("table", { name: "Pods", exact: true }).getByRole("button", { name: "team-a", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "worker-1.example.test", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Failed to schedule pod", exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).controls = {}; });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "pods-one", exact: true })).toBeEnabled();
  await rerender(page, 2, "session-b");
  await expect(page.getByRole("table")).toHaveCount(3);
  await page.evaluate(() => { for (const release of (window as any).releases) release(); });
  await expect(page.getByRole("button", { name: "events-old", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).navigated)).toEqual([]);
});

for (const [kind, namespace, expected] of [["nodes", null, ["pods", "events"]], ["namespaces", null, ["resourceQuotas", "limitRanges", "events"]], ["cronJobs", "team-a", ["jobs", "events"]], ["services", "team-a", ["endpointSlices", "events"]], ["secrets", "team-a", []], ["configMaps", "team-a", []]] as const) {
  test(`${kind} requests only supported collections`, async ({ page }) => {
    await fixture(page, kind, namespace);
    if (expected.length) await expect(page.getByRole("table")).toHaveCount(expected.length);
    await expect.poll(() => page.evaluate(() => (window as any).calls.filter((c: any) => c.command === "cluster_resource_collection").map((c: any) => c.request.collection))).toEqual(expected);
  });
}
test("unresolved UID never fetches", async ({ page }) => {
  await fixture(page, "deployments", "team-a", null);
  expect(await page.evaluate(() => (window as any).calls)).toEqual([]);
});

test("parser rejects crossed identities, scopes, unreviewed fields, counts and bytes", async ({ page }) => {
  await fixture(page);
  const failures = await page.evaluate(async () => {
    const path = "/src/app/cluster/detailCollectionsApi.ts";
    const { parseResourceCollection } = await import(/* @vite-ignore */ path);
    const request = { clusterId: "c", sessionId: "s", readId: 1, reference: { kind: "deployments", namespace: "team-a", name: "parent", uid: "parent-uid" }, collection: "pods" };
    const response = { ...request, state: "complete", items: [{ reference: { kind: "pods", namespace: "team-a", name: "child", uid: "child-uid" }, status: "Running", columns: { ready: "1/1" } }] };
    parseResourceCollection(response, request);
    const mutations = [
      (v: any) => { v.sessionId = "other"; }, (v: any) => { v.clusterId = "other"; }, (v: any) => { v.readId++; },
      (v: any) => { v.reference.uid = "other"; }, (v: any) => { v.reference.kind = "jobs"; }, (v: any) => { v.collection = "jobs"; },
      (v: any) => { v.items[0].reference.uid = null; }, (v: any) => { v.items[0].reference.namespace = "other"; },
      (v: any) => { v.items[0].reference.kind = "jobs"; }, (v: any) => { v.items[0].reference.url = "https://example.test"; },
      (v: any) => { v.items[0].columns.private = "PRIVATE"; }, (v: any) => { v.items[0].status = "bad\nvalue"; },
      (v: any) => { v.items = Array.from({ length: 101 }, () => v.items[0]); }, (v: any) => { v.state = "denied"; },
      (v: any) => { v.items = Array.from({ length: 100 }, (_, i) => ({ ...v.items[0], reference: { ...v.items[0].reference, name: `child-${i}` }, columns: { ready: "x".repeat(256), node: "x".repeat(256), qos: "x".repeat(256) } })); },
    ];
    return mutations.flatMap((mutate, index) => { const value = structuredClone(response); mutate(value); try { parseResourceCollection(value, request); return [index]; } catch (reason) { return reason === "invalidResponse" ? [] : [index]; } });
  });
  expect(failures).toEqual([]);
});

test("pod namespace, node and Event message activate typed references by keyboard", async ({ page }) => {
  await fixture(page);
  const pods = page.getByRole("table", { name: "Pods", exact: true });
  for (const name of ["pods-one", "team-a", "worker-1.example.test"]) {
    await pods.getByRole("button", { name, exact: true }).focus();
    await page.keyboard.press(name === "worker-1.example.test" ? "Space" : "Enter");
  }
  const events = page.getByRole("table", { name: "Events", exact: true });
  await events.getByRole("button", { name: "Failed to schedule pod", exact: true }).focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as any).navigated)).toEqual([
    { kind: "pods", namespace: "team-a", name: "pods-one", uid: "pods-uid" },
    { kind: "namespaces", namespace: null, name: "team-a" },
    { kind: "nodes", namespace: null, name: "worker-1.example.test" },
    { kind: "events", namespace: "team-a", name: "events-one", uid: "events-uid" },
  ]);
  for (const value of ["scheduler", "3", "2026-10-29T10:00:00Z", "Warning"]) await expect(events.getByText(value, { exact: true })).toBeVisible();
  await expect(page.getByText("Pods Status (returned subset, complete): Running: 1", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).calls.filter((call: any) => call.command === "cluster_resource_collection").length)).toBe(3);
});

test("invalid node names stay plain text and empty differs from unavailable", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("table")).toHaveCount(3);
  let revision = 1;
  for (const node of ["Node/worker-1", "https://worker-1", "worker_1", "a".repeat(64)]) {
    await page.evaluate(node => { (window as any).controls = { pods: { node } }; }, node);
    await rerender(page, revision++);
    await expect(page.getByRole("table", { name: "Pods", exact: true }).getByText(node, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: node, exact: true })).toHaveCount(0);
  }
  await page.evaluate(() => { (window as any).controls = { pods: { empty: true }, events: { state: "unavailable" } }; });
  await rerender(page, 100);
  await expect(page.getByText("No related resources.", { exact: true })).toHaveCount(1);
  await expect(page.getByText("The cluster did not provide this related collection.", { exact: true })).toBeVisible();
});

test("Endpoint Slice endpoints remain a count rather than an address list", async ({ page }) => {
  await fixture(page, "services");
  const slices = page.getByRole("table", { name: "Endpoint Slices", exact: true });
  await expect(slices.getByRole("columnheader", { name: "Endpoints", exact: true })).toBeVisible();
  for (const value of ["2", "IPv4", "443/TCP"]) await expect(slices.getByText(value, { exact: true })).toBeVisible();
});
