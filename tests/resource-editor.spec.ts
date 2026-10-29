import { expect, test, type Page } from "@playwright/test";

type Call = { command: string; request: Record<string, unknown> };
async function fixture(page: Page, control: { decision?: string; failure?: boolean; hold?: boolean; malformed?: boolean; kind?: string } = {}) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(control => {
    const calls: Call[] = [];
    let release: () => void = () => {};
    Object.assign(window, { isTauri: true, __editCalls: calls, __editControl: control, __changed: 0, __release: () => release(),
      __TAURI_INTERNALS__: { invoke: async (command: string, args: { request: Record<string, unknown> }) => {
        const r = args.request; calls.push({ command, request: r });
        if (command.endsWith("_cancel")) return null;
        if (command === "cluster_permissions_review") return { clusterId: r.clusterId, sessionId: r.sessionId, readId: r.readId, authorizationEpoch: "fixture", revision: 1,
          checkedAt: Date.now(), expiresAt: Date.now() + 30000,
          items: (r.checks as Record<string, unknown>[]).map(check => ({ check, decision: control.decision ?? "allowed", reason: null })) };
        if (command === "cluster_resource_edit") {
          if (control.hold && r.mode !== "read") await new Promise<void>(resolve => { release = resolve; });
          if (control.failure && r.mode === "apply") throw "connectionFailed";
          return { clusterId: r.clusterId, sessionId: r.sessionId, operationId: control.malformed ? 0 : r.operationId, reference: r.reference,
            resourceVersion: "11", mode: r.mode, accepted: r.mode !== "read", yaml: r.mode === "read" ? 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: demo\n  namespace: team-a\n  uid: controller-uid\n  resourceVersion: "11"\nspec:\n  replicas: 2\n' : null };
        }
        throw new Error(`Unexpected fixture IPC: ${command}`);
      } } });
  }, control);
  const main = await (await page.request.get("/src/main.tsx")).text();
  const reactPath = main.match(/from ["']([^"']*\/react\.js(?:\?[^"']*)?)["']/)?.[1];
  const domPath = main.match(/from ["']([^"']*\/react-dom_client\.js(?:\?[^"']*)?)["']/)?.[1];
  expect(reactPath).toBeTruthy();
  expect(domPath).toBeTruthy();
  await page.route("**/__edit_fixture", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><main id="root"></main>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script>
    <script type="module">
    import React from ${JSON.stringify(reactPath)};
    import ReactDOM from ${JSON.stringify(domPath)};
    const {createRoot}=ReactDOM;
    import {ResourceEditor} from '/src/app/cluster/ResourceEditor.tsx';
    import {PermissionProvider, PermissionSession} from '/src/app/cluster/PermissionProvider.tsx';
    import '/node_modules/@astryxdesign/core/src/reset.css'; import '/node_modules/@astryxdesign/core/dist/astryx.css';
    const e=React.createElement, root=createRoot(document.getElementById('root'));
    const reference={kind:window.__editControl.kind??'deployments',namespace:'team-a',name:'demo',uid:'controller-uid'};
    const detail={clusterId:'one',sessionId:'lease-one',readId:1,reference,item:{name:'demo',namespace:'team-a',uid:'controller-uid',resourceVersion:'11',columns:{},node:null,createdAt:null,status:'Ready'},related:{}};
    root.render(e(PermissionProvider,null,e(PermissionSession,{clusterId:'one',sessionId:'lease-one'},e(ResourceEditor,{clusterId:'one',sessionId:'lease-one',detail,onChanged:()=>window.__changed++}))));
    window.__dispose=()=>root.unmount();
    </script></body></html>` }));
  await page.goto("/__edit_fixture");
}
async function calls(page: Page, mode?: string) {
  return page.evaluate(mode => (window as unknown as { __editCalls: Call[] }).__editCalls.filter(c => c.command === "cluster_resource_edit" && (!mode || c.request.mode === mode)), mode);
}
async function open(page: Page) {
  const button = page.getByRole("button", { name: "Edit YAML", exact: true }); await expect(button).toBeEnabled(); await button.click();
  await expect(page.getByRole("textbox", { name: "Reviewed resource YAML" })).toContainText("replicas: 2");
}
test("reduced read, dry-run and distinct confirmation preserve exact scoped YAML", async ({ page }) => {
  await fixture(page); await open(page);
  const dialog=page.getByRole("dialog");
  await expect(dialog).toContainText("not the full raw resource"); await expect(dialog).toContainText("Omitted server fields");
  const confirm=page.getByRole("button",{name:"Confirm apply",exact:true}); await expect(confirm).toBeDisabled();
  const editor=page.getByRole("textbox",{name:"Reviewed resource YAML"});
  await editor.fill((await editor.innerText()).replace("replicas: 2","replicas: 3"));
  await page.getByRole("button",{name:"Server dry-run",exact:true}).click(); await expect(confirm).toBeEnabled();
  await editor.fill((await editor.innerText()).replace("replicas: 3","replicas: 4")); await expect(confirm).toBeDisabled();
  await page.getByRole("button",{name:"Server dry-run",exact:true}).click(); await expect(confirm).toBeEnabled(); await confirm.click();
  await expect(dialog).toContainText("Changes accepted by the API server");
  const dry=(await calls(page,"dryRun")).at(-1)!; const apply=(await calls(page,"apply"))[0];
  expect(apply.request.yaml).toBe(dry.request.yaml); expect(apply.request).toMatchObject({clusterId:"one",sessionId:"lease-one",resourceVersion:"11",reference:{kind:"deployments",namespace:"team-a",name:"demo",uid:"controller-uid"}});
  expect(apply.request.operationId).not.toBe(dry.request.operationId); await expect(confirm).toBeDisabled();
  expect(await page.evaluate("window.__changed")).toBe(1);
});
test("unknown and denied access cannot open the editor", async ({ page }) => {
  for (const decision of ["unknown","denied"]) {
    await fixture(page,{decision}); await expect(page.getByRole("button",{name:"Edit YAML",exact:true})).toBeDisabled(); expect(await calls(page)).toEqual([]);
    await page.unroute("**/__edit_fixture");
  }
});
test("apply failure warns about uncertainty and requires a fresh baseline", async ({page}) => {
  await fixture(page,{failure:true}); await open(page);
  await page.getByRole("button",{name:"Server dry-run",exact:true}).click();
  const confirm=page.getByRole("button",{name:"Confirm apply",exact:true}); await expect(confirm).toBeEnabled(); await confirm.click();
  await expect(page.getByRole("dialog")).toContainText("The write may have reached the API server"); await expect(confirm).toBeDisabled();
  await expect(page.getByRole("button",{name:"Server dry-run",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Reload baseline",exact:true}).click(); await expect(page.getByRole("button",{name:"Server dry-run",exact:true})).toBeEnabled(); await expect(confirm).toBeDisabled();
});
test("closing cancels the exact operation and discards late dry-run acceptance", async ({page}) => {
  await fixture(page,{hold:true}); await open(page); await page.getByRole("button",{name:"Server dry-run",exact:true}).click();
  await expect.poll(async()=>(await calls(page,"dryRun")).length).toBe(1);
  const request=(await calls(page,"dryRun"))[0].request;
  await page.getByRole("button",{name:"Cancel request and close",exact:true}).click();
  const cancelled=await page.evaluate(()=>(window as unknown as {__editCalls:Call[]}).__editCalls.filter(c=>c.command==="cluster_resource_edit_cancel"));
  expect(cancelled[0].request).toEqual({clusterId:"one",sessionId:"lease-one",operationId:request.operationId});
  await page.evaluate("window.__release()"); await expect(page.getByRole("dialog")).toHaveCount(0); expect(await page.evaluate("window.__changed")).toBe(0);
});
test("malformed baseline response never enables writes", async({page})=>{
  await fixture(page,{malformed:true}); await page.getByRole("button",{name:"Edit YAML",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("No baseline is loaded"); await expect(page.getByRole("button",{name:"Server dry-run",exact:true})).toBeDisabled();
});
test("secrets and unreviewed kinds have no edit action", async({page})=>{
  await fixture(page,{kind:"secrets"}); await expect(page.getByRole("button",{name:"Edit YAML",exact:true})).toHaveCount(0); expect(await calls(page)).toEqual([]);
});
