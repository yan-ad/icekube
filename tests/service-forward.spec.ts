import { expect, test, type Page } from "@playwright/test";

type Call = { command: string; request: Record<string, unknown> };
async function fixture(page: Page, control: { hold?: boolean; malformed?: boolean; decision?: string } = {}) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(control => {
    const calls: Call[] = []; let release: () => void = () => {};
    Object.assign(window, { isTauri: true, __calls: calls, __release: () => release(), __TAURI_INTERNALS__: { invoke: async (command: string, args: { request: Record<string, unknown> }) => {
      const r = args.request; calls.push({ command, request: r });
      if (command === "cluster_permissions_cancel" || command === "cluster_service_forward_cancel" || command === "cluster_pod_forward_stop") return null;
      if (command === "cluster_permissions_review") return { clusterId: r.clusterId, sessionId: r.sessionId, readId: r.readId, authorizationEpoch: "fixture", revision: 1, checkedAt: Date.now(), expiresAt: Date.now() + 30000,
        items: (r.checks as Record<string, unknown>[]).map(check => ({ check, decision: control.decision ?? "allowed", reason: null })) };
      if (command === "cluster_service_forward_start") {
        if (control.hold) await new Promise<void>(resolve => { release = resolve; });
        return { clusterId: r.clusterId, sessionId: r.sessionId, reference: r.reference, servicePort: r.servicePort,
          pod: { kind: "pods", namespace: "default", name: "selected-pod", uid: "pod-uid" },
          forward: { clusterId: r.clusterId, sessionId: r.sessionId, id: "listener-id", namespace: "default", name: control.malformed ? "wrong-pod" : "selected-pod", remotePort: 8080, localPort: 32100, status: "running", error: null } };
      }
      throw new Error(`Unexpected IPC ${command}`);
    } } });
  }, control);
  const main = await (await page.request.get("/src/main.tsx")).text();
  const reactPath = main.match(/from ["']([^"']*\/react\.js(?:\?[^"']*)?)["']/)?.[1];
  const domPath = main.match(/from ["']([^"']*\/react-dom_client\.js(?:\?[^"']*)?)["']/)?.[1];
  expect(reactPath).toBeTruthy();
  expect(domPath).toBeTruthy();
  await page.route("**/src/app/cluster/PermissionProvider.tsx*", route => route.fulfill({ contentType: "application/javascript", body: `export function usePermissionChecks(){return {loading:false,decision:()=>${JSON.stringify(control.decision ?? "allowed")}}}` }));
  await page.route("**/__service_fixture", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><body><main id="root"></main><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    </script><script type="module">
    import React from ${JSON.stringify(reactPath)};
    import ReactDOM from ${JSON.stringify(domPath)};
    const {createRoot}=ReactDOM;
    import {ServiceForwardActions} from '/src/app/cluster/ServiceForwardActions.tsx';

    import '/node_modules/@astryxdesign/core/src/reset.css';import '/node_modules/@astryxdesign/core/dist/astryx.css';
    const e=React.createElement, root=createRoot(document.getElementById('root'));
    const reference={kind:'services',namespace:'default',name:'web',uid:'service-uid'};
    const detail={clusterId:'one',sessionId:'lease',readId:1,reference,item:{name:'web',namespace:'default',uid:'service-uid',resourceVersion:'7',columns:{}},related:{},sections:[{title:'Service ports',facts:[{label:'1 · Port',value:'80'},{label:'1 · Protocol',value:'TCP'},{label:'2 · Port',value:'53'},{label:'2 · Protocol',value:'UDP'}]}]};
    root.render(e(ServiceForwardActions,{clusterId:'one',sessionId:'lease',detail}));
    window.__dispose=()=>root.unmount();
    </script></body></html>` }));
  await page.goto("/__service_fixture");
  await expect(page.getByRole("button", { name: "Forward 80…", exact: true })).toBeVisible();

}
async function calls(page: Page, command: string) { return page.evaluate(command => (window as unknown as { __calls: Call[] }).__calls.filter(c => c.command === command), command); }

test("reviewed TCP port, explicit dialog, bounded local port and loopback result", async ({ page }) => {
  await fixture(page);
  const action = page.getByRole("button", { name: "Forward 80…", exact: true }); await expect(action).toBeEnabled();
  await expect(page.getByRole("button", { name: "Forward 53…", exact: true })).toHaveCount(0);
  await action.click(); await expect(page.getByRole("textbox", { name: "Service port", exact: true })).toHaveValue("80");
  const input = page.getByRole("textbox", { name: "Local port", exact: true }); const start = page.getByRole("button", { name: "Start forward", exact: true });
  for (const bad of ["-1", "65536", "1.5", " 2", "1e2"]) { await input.fill(bad); await expect(start).toBeDisabled(); }
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); expect(await calls(page, "cluster_service_forward_start")).toEqual([]);
  await action.click(); await start.click();
  await expect(page.getByRole("status").filter({ hasText: "Local address" })).toHaveText("Local address: 127.0.0.1:32100");
  await expect(page.getByText("Service default/web:80", { exact: false })).toContainText("Remote connection begins when a local client connects.");
  expect((await calls(page, "cluster_service_forward_start"))[0].request).toMatchObject({ reference: { kind: "services", uid: "service-uid", name: "web" }, resourceVersion: "7", servicePort: 80, localPort: 0 });
});

test("cancel in flight consumes operation and reclaims late successful listener", async ({ page }) => {
  await fixture(page, { hold: true }); await page.getByRole("button", { name: "Forward 80…", exact: true }).click(); await page.getByRole("button", { name: "Start forward", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_service_forward_start")).length).toBe(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const request = (await calls(page, "cluster_service_forward_start"))[0].request;
  expect((await calls(page, "cluster_service_forward_cancel"))[0].request).toEqual({ clusterId: "one", sessionId: "lease", operationId: request.operationId });
  await page.evaluate("window.__release()");
  await expect.poll(async () => (await calls(page, "cluster_pod_forward_stop")).length).toBe(1);
  await expect(page.getByText("Local address:", { exact: false })).toHaveCount(0);
});

test("disposal cancels and malformed nested identity triggers cleanup", async ({ page }) => {
  await fixture(page, { hold: true, malformed: true }); await page.getByRole("button", { name: "Forward 80…", exact: true }).click(); await page.getByRole("button", { name: "Start forward", exact: true }).click();
  await expect.poll(async () => (await calls(page, "cluster_service_forward_start")).length).toBe(1);
  await page.evaluate("window.__dispose();window.__release()");
  await expect.poll(async () => (await calls(page, "cluster_service_forward_cancel")).length).toBe(1);
  await expect.poll(async () => (await calls(page, "cluster_pod_forward_stop")).length).toBe(1);
});

test("strict response rejects extra fields and changed Service/Pod identities", async ({ page }) => {
  await page.goto("/");
  const checks = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this browser-only module path.
    const api = await import("/src/app/cluster/serviceForwardApi.ts");
    const reference = { kind: "services", namespace: "default", name: "web", uid: "service-uid" };
    const r = { clusterId: "one", sessionId: "lease", operationId: 1, reference, resourceVersion: "7", servicePort: 80, localPort: 0 };
    const result = { clusterId: "one", sessionId: "lease", reference, servicePort: 80, pod: { kind: "pods", namespace: "default", name: "selected-pod", uid: "pod-uid" }, forward: { id: "listener-id", clusterId: "one", sessionId: "lease", namespace: "default", name: "selected-pod", remotePort: 8080, localPort: 32100, status: "running", error: null } };
    return [result, { ...result, extra: true }, { ...result, reference: { ...reference, uid: "replaced" } }, { ...result, pod: { ...result.pod, uid: null } }, { ...result, forward: { ...result.forward, remotePort: 0 } }].map(v => { try { api.parseServiceForwardResult(v, r); return true; } catch { return false; } });
  });
  expect(checks).toEqual([true, false, false, false, false]);
});

test("denied or unknown read permissions keep forwarding disabled", async ({ page }) => {
  for (const decision of ["denied", "unknown"]) {
    await fixture(page, { decision });
    await expect(page.getByRole("button", { name: "Forward 80…", exact: true })).toBeDisabled();
    expect(await calls(page, "cluster_service_forward_start")).toEqual([]);
    await page.unroute("**/__service_fixture");
    await page.unroute("**/src/app/cluster/PermissionProvider.tsx*");
  }
});
