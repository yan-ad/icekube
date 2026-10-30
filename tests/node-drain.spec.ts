import { expect, test, type Page } from "@playwright/test";

type Control = { blocked?: boolean; partial?: boolean; holdReview?: boolean; holdExecute?: boolean; pdb?: boolean; malformed?: boolean; expiry?: number; missingUid?: boolean; outcome?: string; executionError?: boolean };
type Call = { command: string; request: Record<string, unknown> };
async function fixture(page: Page, control: Control = {}) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(control => {
    const calls: Call[] = []; let release = () => {}; let epoch = "fixture";
    Object.assign(window, { isTauri: true, __calls: calls, __control: control, __changed: 0, __release: () => release(), __epoch: () => { epoch = "changed"; },
      __TAURI_INTERNALS__: { invoke: async (command: string, args: { request: Record<string, unknown> }) => {
        const request = args.request; calls.push({ command, request });
        if (command.endsWith("_cancel") || command === "cluster_permissions_refresh") return null;
        if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, authorizationEpoch: epoch, revision: 1,
          checkedAt: Date.now(), expiresAt: Date.now() + 5000, items: (request.checks as unknown[]).map(check => ({ check, decision: "allowed", reason: null })) };
        const pod = (name: string, disposition: string, reason: string) => ({ name, namespace: name === "two" ? "other" : "default", uid: name + "-uid", resourceVersion: "1", disposition, reason });
        if (command === "cluster_node_drain_review") {
          if (control.holdReview) await new Promise<void>(resolve => { release = resolve; });
          const blocked = control.blocked || control.partial;
          return { ...request, canDrain: !blocked, partial: !!control.partial, planId: blocked ? null : "a".repeat(32), expiresAt: blocked ? null : Date.now() + (control.expiry ?? 120000),
            pods: control.blocked ? [pod("orphan", "block", "unmanaged"), pod("data", "block", "localData"), pod("mirror", "skip", "mirror"), pod("daemon", "skip", "daemonSet")] : [pod("one", "evict", "managed"), pod("two", "evict", "managed")], ...(control.malformed ? { unknown: true } : {}) };
        }
        if (command === "cluster_node_drain_execute") {
          if (control.holdExecute) await new Promise<void>(resolve => { release = resolve; });
          if (control.executionError) throw "connectionFailed";
          return { clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId, reference: { kind: "nodes", namespace: null, name: "worker", uid: "node-uid" }, cordoned: true, state: control.outcome ?? (control.pdb ? "blocked" : "complete"),
            pods: ["one", "two"].map(name => ({ name, namespace: name === "two" ? "other" : "default", uid: name + "-uid", state: control.pdb ? "blocked" : "evicted", reason: control.pdb ? "disruptionBudget" : null })) };
        }
        throw new Error(`Unexpected fixture IPC ${command}`);
      } } });
  }, control);
  await page.route("**/__drain_fixture", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><main id="root"></main><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    </script><script type="module">
    import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; const {createRoot}=ReactDOM;
    import {NodeDrain} from '/src/app/cluster/NodeDrain.tsx'; import {PermissionProvider,PermissionSession,usePermissions} from '/src/app/cluster/PermissionProvider.tsx';
    import '/node_modules/@astryxdesign/core/src/reset.css'; import '/node_modules/@astryxdesign/core/dist/astryx.css';
    const e=React.createElement,root=createRoot(document.getElementById('root'));let readId=1,sessionId='lease-one';
    function Subject(){ const store=usePermissions(); window.__retry=store.retry;const uid=window.__control.missingUid?null:'node-uid'; const reference={kind:'nodes',namespace:null,name:'worker',uid};
    const detail={clusterId:'one',sessionId,readId,reference,item:{name:'worker',namespace:null,uid,resourceVersion:'11',columns:{},node:{schedulable:true}},related:{}};
    return e(NodeDrain,{clusterId:'one',sessionId,detail,onChanged:()=>window.__changed++});}
    function render(){root.render(e(PermissionProvider,null,e(PermissionSession,{clusterId:'one',sessionId},e(Subject))));}
    window.__refresh=()=>{readId++;render()};window.__session=()=>{sessionId='lease-two';render()};window.__dispose=()=>root.unmount();render();
    </script></body></html>` }));
  await page.goto("/__drain_fixture");
  await expect(page.getByRole("button", { name: "Drain", exact: true })).toBeVisible();
}
async function calls(page: Page, command: string) { return page.evaluate(command => (window as unknown as { __calls: Call[] }).__calls.filter(c => c.command === command), command); }
async function review(page: Page) { await page.getByRole("button", { name: "Drain", exact: true }).click(); await page.getByRole("button", { name: "Review drain", exact: true }).click(); }
async function confirm(page: Page) { await page.getByRole("textbox", { name: "Confirm Node name" }).fill("worker"); await page.getByRole("button", { name: "Confirm drain", exact: true }).click(); }
test("explicit read, typed confirmation, exact IPC and retained outcome", async ({ page }) => {
  await fixture(page); await page.getByRole("button", { name: "Drain", exact: true }).click();
  expect(await calls(page, "cluster_node_drain_review")).toHaveLength(0); expect(await calls(page, "cluster_node_drain_execute")).toHaveLength(0);
  await page.getByRole("button", { name: "Review drain", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm drain", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Confirm Node name" }).fill("wrong"); await expect(page.getByRole("button", { name: "Confirm drain", exact: true })).toBeDisabled();
  await confirm(page); await expect(page.getByRole("dialog")).toContainText("Drain result: complete");
  await expect(page.getByRole("dialog")).toContainText("not certification"); expect(await page.evaluate("window.__changed")).toBe(0);
  const read = (await calls(page, "cluster_node_drain_review"))[0].request;
  expect(read).toEqual({ clusterId: "one", sessionId: "lease-one", operationId: expect.any(Number), reference: { kind: "nodes", namespace: null, name: "worker", uid: "node-uid" }, resourceVersion: "11" });
  const write = (await calls(page, "cluster_node_drain_execute"))[0].request;
  expect(write).toEqual({ clusterId: "one", sessionId: "lease-one", operationId: expect.any(Number), planId: "a".repeat(32) }); expect(write.operationId).not.toBe(read.operationId);
  const checks = (await calls(page, "cluster_permissions_review")).flatMap(c => c.request.checks as unknown[]);
  expect(checks).toContainEqual({ kind: "pods", namespace: null, name: null, action: "list" }); expect(checks.some(c => (c as {action:string}).action === "evict")).toBe(false);
  await page.getByRole("button", { name: "Close and reload details" }).click(); expect(await page.evaluate("window.__changed")).toBe(1);
});
test("orphan and local data block, mirror and DaemonSet remain", async ({ page }) => {
  await fixture(page, { blocked: true }); await review(page); const dialog = page.getByRole("dialog");
  for (const text of ["Unmanaged Pod", "Local data", "Mirror Pod remains", "DaemonSet Pod remains"]) await expect(dialog).toContainText(text);
  await expect(page.getByRole("button", { name: "Confirm drain", exact: true })).toBeDisabled(); expect(await calls(page, "cluster_node_drain_execute")).toHaveLength(0);
});
test("partial review blocks execution", async ({ page }) => { await fixture(page, { partial: true }); await review(page); await expect(page.getByRole("dialog")).toContainText("Incomplete inventory"); await expect(page.getByRole("button", { name: "Confirm drain", exact: true })).toBeDisabled(); });
test("429 outcome is PDB or rate limit, never replayed", async ({ page }) => { await fixture(page, { pdb: true }); await review(page); await confirm(page); await expect(page.getByRole("dialog")).toContainText("PodDisruptionBudget or API rate limit blocked eviction"); expect(await calls(page, "cluster_node_drain_execute")).toHaveLength(1); await expect(page.getByRole("button", { name: "Confirm drain", exact: true })).toHaveCount(0); });
test("expiry disables typed confirmation live", async ({ page }) => { await fixture(page, { expiry: 800 }); await review(page); await page.getByRole("textbox", { name: "Confirm Node name" }).fill("worker"); await expect(page.getByRole("dialog")).toContainText("review expired"); await expect(page.getByRole("button", { name: "Confirm drain", exact: true })).toBeDisabled(); expect(await calls(page, "cluster_node_drain_cancel")).toHaveLength(1); });
test("permission epoch invalidates reviewed plan", async ({ page }) => { await fixture(page); await review(page); await expect(page.getByRole("textbox", { name: "Confirm Node name" })).toBeVisible(); await page.evaluate("window.__epoch();window.__retry()"); await expect(page.getByRole("dialog")).toContainText("Permissions changed after review"); await expect(page.getByRole("button", { name: "Confirm drain", exact: true })).toBeDisabled(); });
for (const change of ["__refresh", "__session", "__dispose"]) test(`${change} cancels exact pending review and ignores late reply`, async ({ page }) => {
  await fixture(page, { holdReview: true }); await review(page); await expect.poll(async () => (await calls(page, "cluster_node_drain_review")).length).toBe(1);
  const request = (await calls(page, "cluster_node_drain_review"))[0].request; await page.evaluate(change => (window as unknown as Record<string, () => void>)[change](), change);
  await expect.poll(async () => (await calls(page, "cluster_node_drain_cancel")).length).toBe(1); expect((await calls(page, "cluster_node_drain_cancel"))[0].request).toEqual({ clusterId: "one", sessionId: "lease-one", operationId: request.operationId });
  await page.evaluate("window.__release()"); expect(await calls(page, "cluster_node_drain_execute")).toHaveLength(0); expect(await page.evaluate("window.__changed")).toBe(0);
});
test("Stop uses execution ID and Escape cannot close busy dialog", async ({ page }) => {
  await fixture(page, { holdExecute: true }); await review(page); await confirm(page); await page.keyboard.press("Escape"); await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click(); const execution = (await calls(page, "cluster_node_drain_execute"))[0].request;
  expect((await calls(page, "cluster_node_drain_cancel"))[0].request).toEqual({ clusterId: "one", sessionId: "lease-one", operationId: execution.operationId });
  await page.evaluate("window.__release()"); await expect(page.getByRole("dialog")).toContainText("Drain result"); expect(await calls(page, "cluster_node_drain_execute")).toHaveLength(1);
});
test("keyboard Cancel invalidates review and restores focus at 300 wide", async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 720 }); await fixture(page); const trigger = page.getByRole("button", { name: "Drain", exact: true }); await trigger.focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Review drain", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Confirm Node name" })).toBeVisible(); await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(trigger).toBeFocused(); expect(await calls(page, "cluster_node_drain_cancel")).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("missing UID prevents drain", async ({ page }) => { await fixture(page, { missingUid: true }); await expect(page.getByRole("button", { name: "Drain", exact: true })).toBeDisabled(); });
for (const outcome of ["cancelled", "partial", "timeout", "uncertain"]) test(`${outcome} remains visible without replay or automatic refresh`, async ({ page }) => {
  await fixture(page, { outcome }); await review(page); await confirm(page); await expect(page.getByRole("dialog")).toContainText(`Drain result: ${outcome}`);
  expect(await page.evaluate("window.__changed")).toBe(0); expect(await calls(page, "cluster_node_drain_execute")).toHaveLength(1); await expect(page.getByRole("button", { name: "Confirm drain", exact: true })).toHaveCount(0);
});
test("execution transport failure consumes plan and reloads only on close", async ({ page }) => {
  await fixture(page, { executionError: true }); await review(page); await confirm(page); await expect(page.getByRole("alert")).toContainText("outcome is uncertain");
  expect(await calls(page, "cluster_node_drain_execute")).toHaveLength(1); expect(await page.evaluate("window.__changed")).toBe(0);
  await page.getByRole("button", { name: "Close and reload details" }).click(); expect(await page.evaluate("window.__changed")).toBe(1);
});
test("malformed review never enables confirmation", async ({ page }) => { await fixture(page, { malformed: true }); await review(page); await expect(page.getByRole("alert")).toContainText("Reload details"); await expect(page.getByRole("button", { name: "Confirm drain", exact: true })).toBeDisabled(); });
test("closed parsers reject scope, shape, budget, duplicate and false complete claims", async ({ page }) => {
  await fixture(page); const result = await page.evaluate(async () => {
    // @ts-expect-error Browser fixture loads the real IPC parser.
    const api = await import("/src/app/cluster/nodeDrainApi.ts");
    const request = { clusterId: "one", sessionId: "lease-one", operationId: 1, reference: { kind: "nodes", namespace: null, name: "worker", uid: "node-uid" }, resourceVersion: "11" };
    const pod = { name: "one", namespace: "default", uid: "pod-uid", resourceVersion: "1", disposition: "evict", reason: "managed" };
    const review = { ...request, planId: "a".repeat(32), expiresAt: Date.now() + 10000, pods: [pod], canDrain: true, partial: false };
    const reject = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
    const bad = [{ ...review, extra: true }, { ...review, sessionId: "other" }, { ...review, partial: true }, { ...review, canDrain: false }, { ...review, pods: [pod, pod] }, { ...review, pods: Array(101).fill(pod) }, { ...review, reference: { ...request.reference, uid: "other" } }, { ...review, pods: [{ ...pod, reason: "unknown" }] }, { ...review, extra: "界".repeat(65536) }];
    const write = { clusterId: "one", sessionId: "lease-one", operationId: 2, planId: review.planId };
    const outcome = { clusterId: "one", sessionId: "lease-one", operationId: 2, reference: request.reference, cordoned: true, state: "complete", pods: [{ name: "one", namespace: "default", uid: "pod-uid", state: "evicted", reason: null }] };
    const invalid = [{ ...outcome, cordoned: false }, { ...outcome, pods: [] }, { ...outcome, pods: [{ ...outcome.pods[0], state: "pending" }] }, { ...outcome, pods: [{ ...outcome.pods[0], state: "skipped" }] }, { ...outcome, extra: true }];
    return { review: bad.every(v => reject(() => api.parseDrainReview(v, request))), result: invalid.every(v => reject(() => api.parseDrainResult(v, write, review))), valid: api.parseDrainResult(outcome, write, api.parseDrainReview(review, request)).state };
  }); expect(result).toEqual({ review: true, result: true, valid: "complete" });
});
