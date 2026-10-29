import { expect, test, type Page } from "@playwright/test";

type Control = { decision?: string; hold?: boolean; failure?: boolean; malformed?: boolean; kind?: string; suspend?: string; missingUid?: boolean };
type Call = { command: string; request: Record<string, unknown> };
async function fixture(page: Page, control: Control = {}) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(control => {
    const calls: Call[] = [];
    let release: () => void = () => {};
    Object.assign(window, { isTauri: true, __workloadCalls: calls, __control: control, __changed: 0,
      __release: () => release(), __TAURI_INTERNALS__: { invoke: async (command: string, args: { request: Record<string, unknown> }) => {
        const request = args.request;
        calls.push({ command, request });
        if (command === "cluster_permissions_cancel" || command === "cluster_workload_action_cancel") return null;
        if (command === "cluster_permissions_review") return { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId, authorizationEpoch: "fixture", revision: 1,
          checkedAt: Date.now(), expiresAt: Date.now() + 30000,
          items: (request.checks as Record<string, unknown>[]).map(check => ({ check, decision: control.decision ?? "allowed", reason: control.decision === "denied" ? "reviewDenied" : null })) };
        if (command === "cluster_workload_action") {
          if (control.hold) await new Promise<void>(resolve => { release = resolve; });
          if (control.failure) throw "connectionFailed";
          return { clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId,
            reference: request.reference, action: request.action, accepted: !control.malformed,
            created: request.action === "trigger" ? { kind: "jobs", namespace: "team-a", name: "nightly-manual", uid: "job-uid" } : null };
        }
        throw new Error(`Unexpected fixture IPC: ${command}`);
      } } });
  }, control);
  await page.route("**/__workload_fixture", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><main id="root"></main><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module">
    import React from '/node_modules/@tanstack/redact/dist/react/index.js';
    import {createRoot} from '/node_modules/@tanstack/redact/dist/dom/client.js';
    import {WorkloadActions} from '/src/app/cluster/WorkloadActions.tsx';
    import {PermissionProvider, PermissionSession} from '/src/app/cluster/PermissionProvider.tsx';
    import '/node_modules/@astryxdesign/core/src/reset.css';
    import '/node_modules/@astryxdesign/core/dist/astryx.css';
    const e=React.createElement, control=window.__control;
    let readId=1, uid=control.missingUid ? null : 'controller-uid';
    const root=createRoot(document.getElementById('root'));
    function render(){ const reference={kind:control.kind??'deployments',namespace:'team-a',name:'nightly',uid};
      const detail={clusterId:'one',sessionId:'lease-one',readId,reference,item:{name:'nightly',namespace:'team-a',uid,resourceVersion:'11',columns:{suspend:control.suspend??'false'},node:null,createdAt:null,status:'Ready'},related:{}};
      root.render(e(PermissionProvider,null,e(PermissionSession,{clusterId:'one',sessionId:'lease-one'},e(WorkloadActions,{clusterId:'one',sessionId:'lease-one',detail,onChanged:()=>window.__changed++}))));
    }
    window.__refresh=()=>{readId++;render()}; window.__dispose=()=>root.unmount(); render();
    </script></body></html>` }));
  await page.goto("/__workload_fixture");
  await expect(page.getByRole("button", { name: control.kind === "cronJobs" ? "Trigger" : control.kind === "jobs" ? (control.suspend === "true" ? "Resume" : "Suspend") : "Scale", exact: true })).toBeVisible();
}
async function calls(page: Page, command = "cluster_workload_action") {
  return page.evaluate(command => (window as unknown as { __workloadCalls: Call[] }).__workloadCalls.filter(call => call.command === command), command);
}
async function run(page: Page, code: string) { await page.evaluate(code); }

test("scale confirms exact identity, bounds integers, cancels without IPC, and reports acceptance", async ({ page }) => {
  await fixture(page);
  const scale = page.getByRole("button", { name: "Scale", exact: true });
  await expect(scale).toBeEnabled(); await scale.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Cluster: one. Namespace: team-a.");
  await expect(dialog).toContainText("UID: controller-uid. Resource version: 11.");
  const input = page.getByRole("textbox", { name: "Replicas", exact: true });
  const confirm = page.getByRole("button", { name: "Confirm action", exact: true });
  for (const invalid of ["", "-1", "1.5", "2147483648", "1e2", " 3"]) { await input.fill(invalid); await expect(confirm).toBeDisabled(); }
  await input.fill("0"); await expect(confirm).toBeEnabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await calls(page)).toEqual([]);
  await scale.click(); await input.fill("2147483647"); await confirm.click();
  await expect(page.getByRole("status").filter({ hasText: "action accepted" })).toContainText("Scale action accepted.");
  await expect(page.getByRole("status").filter({ hasText: "action accepted" })).toContainText("does not confirm rollout");
  expect(await calls(page)).toHaveLength(1);
  expect((await calls(page))[0].request).toMatchObject({ clusterId: "one", sessionId: "lease-one", resourceVersion: "11", action: "scale", replicas: 2147483647,
    reference: { kind: "deployments", namespace: "team-a", name: "nightly", uid: "controller-uid" } });
  expect(await page.evaluate("window.__changed")).toBe(1);
  await expect(scale).toBeDisabled();
});

test("permission denials, unknown reviews and missing UID cannot submit", async ({ page }) => {
  for (const control of [{ decision: "denied" }, { decision: "unknown" }, { missingUid: true }]) {
    await fixture(page, control);
    await expect(page.getByRole("button", { name: "Scale", exact: true })).toBeDisabled();
    expect(await calls(page)).toEqual([]);
    await page.unroute("**/__workload_fixture");
  }
});

test("stop and disposal cancel only the exact operation and ignore late acceptance", async ({ page }) => {
  await fixture(page, { hold: true });
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("OnDelete controllers do not immediately replace existing Pods");
  await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const request = (await calls(page))[0].request;
  const exact = { clusterId: "one", sessionId: "lease-one", operationId: request.operationId };
  expect((await calls(page, "cluster_workload_action_cancel"))[0].request).toEqual(exact);
  await run(page, "window.__dispose()");
  await expect.poll(async () => (await calls(page, "cluster_workload_action_cancel")).length).toBe(2);
  expect((await calls(page, "cluster_workload_action_cancel"))[1].request).toEqual(exact);
  await run(page, "window.__release()");
  expect(await page.evaluate("window.__changed")).toBe(0);
});

for (const control of [{ failure: true }, { malformed: true }]) test(`uncertain ${control.failure ? "failure" : "response"} requires explicit detail refresh without replay`, async ({ page }) => {
  await fixture(page, control);
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Refresh details before another workload action.");
  await expect(page.getByRole("button", { name: "Restart", exact: true })).toBeDisabled();
  expect(await page.evaluate("window.__changed")).toBe(0);
  expect(await calls(page)).toHaveLength(1);
  await run(page, "window.__refresh()");
  await expect(page.getByRole("button", { name: "Restart", exact: true })).toBeEnabled();
  expect(await calls(page)).toHaveLength(1);
});

test("CronJob trigger checks parent get plus namespace Job create and returns created Job", async ({ page }) => {
  await fixture(page, { kind: "cronJobs", suspend: "false" });
  await expect(page.getByRole("button", { name: "Suspend", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Trigger", exact: true }).click();
  await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "action accepted" })).toContainText("Job team-a/nightly-manual created");
  const checks = (await calls(page, "cluster_permissions_review")).flatMap(call => call.request.checks as unknown[]);
  expect(checks).toContainEqual({ kind: "cronJobs", namespace: "team-a", name: "nightly", action: "get" });
  expect(checks).toContainEqual({ kind: "jobs", namespace: "team-a", name: null, action: "create" });
  expect((await calls(page))[0].request.replicas).toBeNull();
});

test("suspended Jobs expose Resume and never Trigger", async ({ page }) => {
  await fixture(page, { kind: "jobs", suspend: "true" });
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Trigger", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "action accepted" })).toContainText("Resume action accepted");
});

test("controller action matrix excludes unsupported operations and unknown suspension", async ({ page }) => {
  await page.goto("/");
  const matrix = await page.evaluate(async () => {
    const { workloadActions } = await import("/src/app/cluster/WorkloadActions.tsx" as string);
    return ["deployments", "statefulSets", "replicaSets", "replicationControllers", "daemonSets", "jobs", "cronJobs", "pods", "services"].map(kind => ({ kind, actions: workloadActions({ reference: { kind }, item: { columns: {} } }) }));
  });
  expect(matrix).toEqual([
    { kind: "deployments", actions: ["scale", "restart"] }, { kind: "statefulSets", actions: ["scale", "restart"] },
    { kind: "replicaSets", actions: ["scale"] }, { kind: "replicationControllers", actions: ["scale"] },
    { kind: "daemonSets", actions: ["restart"] }, { kind: "jobs", actions: [] }, { kind: "cronJobs", actions: ["trigger"] },
    { kind: "pods", actions: [] }, { kind: "services", actions: [] },
  ]);
});

test("closed DTO rejects extra keys, scope, UID, flags and created references", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { validWorkloadRequest, parseWorkloadActionResult } = await import("/src/app/cluster/workloadActionsApi.ts" as string);
    const request = { clusterId: "one", sessionId: "session", operationId: 1, reference: { kind: "cronJobs", namespace: "team-a", name: "nightly", uid: "uid" }, resourceVersion: "11", action: "trigger", replicas: null };
    const response = { clusterId: "one", sessionId: "session", operationId: 1, reference: request.reference, action: "trigger", accepted: true, created: { kind: "jobs", namespace: "team-a", name: "manual", uid: "new-uid" } };
    const rejects = (value: unknown) => { try { parseWorkloadActionResult(value, request); return false; } catch { return true; } };
    return { valid: validWorkloadRequest(request), badRequests: [{ ...request, extra: true }, { ...request, replicas: 1 }, { ...request, reference: { ...request.reference, uid: null } }, { ...request, reference: { ...request.reference, namespace: null } }].map(validWorkloadRequest),
      badResponses: [{ ...response, extra: true }, { ...response, accepted: false }, { ...response, operationId: 2 }, { ...response, reference: { ...response.reference, uid: "replaced" } }, { ...response, created: null }, { ...response, created: { ...response.created, kind: "pods" } }, { ...response, created: { ...response.created, namespace: "other" } }, { ...response, created: { ...response.created, uid: null } }].map(rejects) };
  });
  expect(result.valid).toBe(true);
  expect(result.badRequests).toEqual([false, false, false, false]);
  expect(result.badResponses.every(Boolean)).toBe(true);
});
