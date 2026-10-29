import { expect, test, type Page } from "@playwright/test";

type Control = { schedulable?: boolean; decision?: string; hold?: boolean; failure?: boolean; malformed?: boolean; missingUid?: boolean; missingVersion?: boolean; mismatch?: boolean };
type Call = { command: string; request: Record<string, unknown> };
async function fixture(page: Page, control: Control = {}) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(control => {
    const calls: Call[] = []; let release: () => void = () => {};
    Object.assign(window, { isTauri: true, __nodeCalls: calls, __control: control, __changed: 0, __release: () => release(),
      __TAURI_INTERNALS__: { invoke: async (command: string, args: { request: Record<string, unknown> }) => {
        const request = args.request; calls.push({ command, request });
        if (command === "cluster_permissions_cancel" || command === "cluster_node_action_cancel") return null;
        if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, authorizationEpoch: "fixture", revision: 1,
          checkedAt: Date.now(), expiresAt: Date.now() + 30000, items: (request.checks as Record<string, unknown>[]).map(check => ({ check, decision: control.decision ?? "allowed", reason: null })) };
        if (command === "cluster_node_action") {
          if (control.hold) await new Promise<void>(resolve => { release = resolve; });
          if (control.failure) throw "connectionFailed";
          return { clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId,
            reference: request.reference, action: request.action, accepted: true, ...(control.malformed ? { secret: "must reject" } : {}) };
        }
        throw new Error(`Unexpected fixture IPC: ${command}`);
      } } });
  }, control);
  await page.route("**/__node_fixture", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><main id="root"></main><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; const {createRoot}=ReactDOM;
    import {NodeActions} from '/src/app/cluster/NodeActions.tsx';
    import {PermissionProvider, PermissionSession} from '/src/app/cluster/PermissionProvider.tsx';
    import '/node_modules/@astryxdesign/core/src/reset.css'; import '/node_modules/@astryxdesign/core/dist/astryx.css';
    const e=React.createElement, control=window.__control, root=createRoot(document.getElementById('root')); let readId=1;
    function render(){ const uid=control.missingUid ? null : 'node-uid'; const reference={kind:'nodes',namespace:null,name:'worker',uid};
      const detail={clusterId:'one',sessionId:'lease-one',readId,reference,item:{name:'worker',namespace:null,uid:control.mismatch?'other':uid,resourceVersion:control.missingVersion?null:'11',columns:{},node:{schedulable:control.schedulable??true},createdAt:null,status:'Ready'},related:{}};
      root.render(e(PermissionProvider,null,e(PermissionSession,{clusterId:'one',sessionId:'lease-one'},e(NodeActions,{clusterId:'one',sessionId:'lease-one',detail,onChanged:()=>window.__changed++})))); }
    window.__refresh=()=>{readId++;render()}; window.__dispose=()=>root.unmount(); render();
    </script></body></html>` }));
  await page.goto("/__node_fixture");
  await expect(page.getByRole("button", { name: control.schedulable === false ? "Uncordon" : "Cordon", exact: true })).toBeVisible();
}
async function calls(page: Page, command = "cluster_node_action") {
  return page.evaluate(command => (window as unknown as { __nodeCalls: Call[] }).__nodeCalls.filter(call => call.command === command), command);
}
for (const schedulable of [true, false]) test(`${schedulable ? "Cordon" : "Uncordon"} confirms scheduling-only effect and exact identity`, async ({ page }) => {
  await fixture(page, { schedulable });
  const button = page.getByRole("button", { name: schedulable ? "Cordon" : "Uncordon", exact: true });
  await expect(button).toBeEnabled(); await button.click();
  await expect(page.getByRole("dialog")).toContainText("This does not evict existing Pods.");
  await expect(page.getByRole("dialog")).toContainText("UID: node-uid. Resource version: 11.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); expect(await calls(page)).toEqual([]);
  await button.click(); await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "action accepted" })).toContainText("action accepted"); await expect(button).toBeDisabled();
  const sent = await calls(page); expect(sent).toHaveLength(1);
  expect(sent[0].request).toMatchObject({ clusterId: "one", sessionId: "lease-one", action: schedulable ? "cordon" : "uncordon", resourceVersion: "11", reference: { kind: "nodes", namespace: null, name: "worker", uid: "node-uid" } });
  const checks = (await calls(page, "cluster_permissions_review")).flatMap(call => call.request.checks as unknown[]);
  for (const action of ["get", "patch"]) expect(checks).toContainEqual({ kind: "nodes", namespace: null, name: "worker", action });
  expect(await page.evaluate("window.__changed")).toBe(1);
});
for (const control of [{ decision: "denied" }, { decision: "unknown" }, { missingUid: true }, { missingVersion: true }, { mismatch: true }]) test(`guards ${JSON.stringify(control)}`, async ({ page }) => {
  await fixture(page, control); await expect(page.getByRole("button", { name: "Cordon", exact: true })).toBeDisabled(); expect(await calls(page)).toEqual([]);
});
for (const control of [{ failure: true }, { malformed: true }]) test(`uncertain ${JSON.stringify(control)} blocks replay until refreshed`, async ({ page }) => {
  await fixture(page, control); await page.getByRole("button", { name: "Cordon", exact: true }).click();
  await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "write may have reached" })).toContainText("write may have reached");
  await expect(page.getByRole("button", { name: "Cordon", exact: true })).toBeDisabled();
  expect(await calls(page)).toHaveLength(1); expect(await page.evaluate("window.__changed")).toBe(0);
  await page.evaluate("window.__refresh()"); await expect(page.getByRole("button", { name: "Cordon", exact: true })).toBeEnabled(); expect(await calls(page)).toHaveLength(1);
});
test("stop and disposal cancel exact operation, ignoring late response", async ({ page }) => {
  await fixture(page, { hold: true }); await page.getByRole("button", { name: "Cordon", exact: true }).click();
  await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const request = (await calls(page))[0].request;
  const exact = { clusterId: "one", sessionId: "lease-one", operationId: request.operationId };
  expect((await calls(page, "cluster_node_action_cancel"))[0].request).toEqual(exact);
  await page.evaluate("window.__dispose()");
  await expect.poll(async () => (await calls(page, "cluster_node_action_cancel")).length).toBe(2);
  expect((await calls(page, "cluster_node_action_cancel"))[1].request).toEqual(exact);
  await page.evaluate("window.__release()"); expect(await page.evaluate("window.__changed")).toBe(0);
});
test("IPC parser rejects extra fields, wrong scope, resource, action and invalid baselines", async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Browser fixture imports the application's actual adapter.
    const api = await import("/src/app/cluster/nodeActionsApi.ts");
    const request = { clusterId: "one", sessionId: "lease-one", operationId: 8, reference: { kind: "nodes", namespace: null, name: "worker", uid: "node-uid" }, resourceVersion: "11", action: "cordon" };
    const value = { clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId, reference: request.reference, action: request.action, accepted: true };
    const bad = [{ ...value, secret: "x" }, { ...value, sessionId: "old" }, { ...value, operationId: 9 }, { ...value, action: "uncordon" }, { ...value, accepted: "true" }, { ...value, reference: { ...request.reference, uid: "other" } }];
    return { rejected: bad.every(v => { try { api.parseNodeActionResult(v, request); return false; } catch { return true; } }),
      invalid: [ { ...request, action: "drain" }, { ...request, resourceVersion: "" }, { ...request, reference: { ...request.reference, namespace: "default" } }, { ...request, reference: { ...request.reference, uid: null } } ].every(v => !api.validNodeActionRequest(v)),
      acceptedFalse: api.parseNodeActionResult({ ...value, accepted: false }, request).accepted };
  });
  expect(result).toEqual({ rejected: true, invalid: true, acceptedFalse: false });
});
