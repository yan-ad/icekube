import { expect, test } from "@playwright/test";

test("custom metadata parsers reject stale scope, malformed identities, and unprojected payloads", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/app/cluster/customResourcesApi.ts";
    const { parseCustomInstances, parseCustomDefinitions } = await import(/* @vite-ignore */ path);
    const request = { clusterId: "one", sessionId: "session-one", readId: 5, definitionName: "widgets.example.test", definitionUid: "definition-one", namespace: null };
    const response = { clusterId: "one", sessionId: "session-one", readId: 5, target: { definitionName: request.definitionName, definitionUid: request.definitionUid },
      group: "example.test", version: "vnext", plural: "widgets", kind: "Widget", namespaced: true, namespace: null,
      continueToken: "next-token", truncated: true, items: [{ name: "sample.widget", uid: "widget-one", namespace: "default", createdAt: "2026-10-27T10:00:00Z", labelCount: 2 }] };
    const failures: string[] = [];
    const parsed = parseCustomInstances(response, request);
    if (parsed.group !== "example.test" || parsed.version !== "vnext" || !parsed.namespaced || !parsed.truncated || parsed.continueToken !== "next-token") failures.push("lost safe descriptor or pagination");
    if (parsed === response || parsed.items === response.items || parsed.items[0] === response.items[0] || parsed.target === response.target) failures.push("retained raw response references");
    const reject = (label: string, run: () => unknown, expected = "invalidResponse") => {
      try { run(); failures.push(`accepted ${label}`); } catch (error) { if (error !== expected) failures.push(`${label}: ${error}`); }
    };
    const mutations: [string, (v: any) => void][] = [
      ["cluster", v => { v.clusterId = "other"; }], ["session", v => { v.sessionId = "other"; }],
      ["read", v => { v.readId++; }], ["read type", v => { v.readId = "5"; }],
      ["definition name", v => { v.target.definitionName = "others.example.test"; }],
      ["definition UID", v => { v.target.definitionUid = "replacement"; }],
      ["hidden target", v => { v.target.spec = "PRIVATE"; }],
      ["different group", v => { v.group = "different.test"; }], ["different plural", v => { v.plural = "others"; }],
      ["bad version", v => { v.version = "v1/secret"; }], ["bad kind", v => { v.kind = "1Widget"; }],
      ["kind controls", v => { v.kind = "Widget\u202e"; }], ["scope type", v => { v.namespaced = "true"; }],
      ["namespace scope", v => { v.namespace = "default"; }], ["missing namespace", v => { delete v.items[0].namespace; }],
      ["null namespaced namespace", v => { v.items[0].namespace = null; }],
      ["cluster item namespace", v => { v.namespaced = false; }],
      ["invalid namespace", v => { v.items[0].namespace = "../default"; }],
      ["name empty DNS segment", v => { v.items[0].name = "sample..widget"; }],
      ["name invalid DNS edge", v => { v.items[0].name = "sample.-widget"; }],
      ["name segment length", v => { v.items[0].name = "a".repeat(64); }],
      ["missing UID", v => { delete v.items[0].uid; }], ["null UID", v => { v.items[0].uid = null; }],
      ["long UID", v => { v.items[0].uid = "a".repeat(257); }], ["UID controls", v => { v.items[0].uid = "a\n"; }],
      ["UID bidi", v => { v.items[0].uid = "a\u2066"; }], ["timestamp", v => { v.items[0].createdAt = "not-time"; }],
      ["negative count", v => { v.items[0].labelCount = -1; }], ["fraction count", v => { v.items[0].labelCount = 0.5; }],
      ["unsafe count", v => { v.items[0].labelCount = Number.MAX_SAFE_INTEGER + 1; }],
      ["duplicate name", v => { v.items.push({ ...v.items[0], uid: "different" }); }],
      ["duplicate UID", v => { v.items.push({ ...v.items[0], name: "different" }); }],
      ["oversize page", v => { v.items = Array.from({ length: 101 }, (_, i) => ({ ...v.items[0], name: `item-${i}`, uid: `uid-${i}` })); }],
      ["token controls", v => { v.continueToken = "next\n"; }], ["token whitespace", v => { v.continueToken = "next token"; }],
      ["missing truncated", v => { delete v.truncated; }], ["unexpected fetchedAt", v => { v.fetchedAt = 10; }],
      ...["spec", "status", "annotations", "data", "metadata"].map(key => [`hidden top ${key}`, (v: any) => { v[key] = { credential: "PRIVATE" }; }] as [string, (v: any) => void]),
      ...["spec", "status", "annotations", "data", "metadata", "labels"].map(key => [`hidden item ${key}`, (v: any) => { v.items[0][key] = { credential: "PRIVATE" }; }] as [string, (v: any) => void]),
    ];
    for (const [label, mutate] of mutations) { const invalid = structuredClone(response); mutate(invalid); reject(label, () => parseCustomInstances(invalid, request)); }
    reject("selected namespace mismatch", () => parseCustomInstances({ ...response, namespace: "other" }, { ...request, namespace: "other" }));
    reject("namespace for cluster resource", () => parseCustomInstances({ ...response, namespaced: false, namespace: "default", items: [] }, { ...request, namespace: "default" }));
    const clusterPage = parseCustomInstances({ ...response, namespaced: false, items: [{ ...response.items[0], namespace: null, createdAt: null }] }, request);
    if (clusterPage.items[0].namespace !== null) failures.push("cluster namespace changed");
    const allNamespaces = parseCustomInstances({ ...response, items: [response.items[0], { ...response.items[0], namespace: "other", uid: "widget-two" }] }, request);
    if (allNamespaces.items.length !== 2) failures.push("rejected same name across namespaces");
    for (const invalid of [{ ...request, readId: 0 }, { ...request, readId: NaN }, { ...request, sessionId: " " }, { ...request, clusterId: "one\u202e" }, { ...request, definitionName: "widgets.-example.test" }, { ...request, definitionUid: "bad\u2066" }, { ...request, continueToken: "bad token" }]) {
      reject("invalid request", () => parseCustomInstances(response, invalid), "invalidInput");
    }
    const discovery = { clusterId: "one", sessionId: "session-one", readId: 5, kind: "customResourceDefinitions", namespace: null, metrics: null,
      continueToken: null, truncated: false, fetchedAt: 1793000000000, items: [{ name: request.definitionName, uid: request.definitionUid, resourceVersion: "1", namespace: null,
        status: "Unknown", createdAt: null, columns: { group: "example.test", plural: "widgets", kind: "Widget", scope: "Namespaced", versions: "vnext,v1", shortNames: "wdg" }, node: null }] };
    const definitions = parseCustomDefinitions(discovery, request);
    if (definitions.items[0].version !== "vnext" || Object.keys(definitions.items[0]).length !== 7) failures.push("incorrect discovery projection");
    for (const [label, mutate] of [
      ["discovery session", (v: any) => { v.sessionId = "other"; }],
      ["discovery namespace", (v: any) => { v.namespace = "default"; }],
      ["discovery kind", (v: any) => { v.kind = "pods"; }],
      ["discovery hidden top", (v: any) => { v.spec = "PRIVATE"; }],
      ["discovery hidden item", (v: any) => { v.items[0].spec = "PRIVATE"; }],
      ["discovery hidden columns", (v: any) => { v.items[0].columns.annotations = "PRIVATE"; }],
      ["discovery raw node", (v: any) => { v.items[0].node = {}; }],
      ["discovery duplicate", (v: any) => { v.items.push(v.items[0]); }],
      ["discovery mismatched group", (v: any) => { v.items[0].columns.group = "other.test"; }],
      ["discovery missing UID", (v: any) => { v.items[0].uid = null; }],
    ] as [string, (v: any) => void][]) { const invalid = structuredClone(discovery); mutate(invalid); reject(label, () => parseCustomDefinitions(invalid, request)); }
    return { failures, checked: mutations.length };
  });
  expect(result.failures).toEqual([]);
  expect(result.checked).toBeGreaterThan(40);
});

test("custom IPC constructs closed dedicated scopes for reads and cancellation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { isTauri: true, __customCalls: [], __TAURI_INTERNALS__: { invoke: async (command: string, args: { request: Record<string, unknown> }) => {
      (window as any).__customCalls.push({ command, request: args.request });
      if (command.endsWith("_cancel")) return null;
      if (command === "cluster_custom_resource_definitions") return { ...args.request, kind: "customResourceDefinitions", namespace: null, metrics: null, continueToken: null, truncated: false, fetchedAt: 0, items: [] };
      if (command === "cluster_custom_resources") return { ...args.request, group: "example.test", version: "v1", plural: "widgets", kind: "Widget", namespaced: true, continueToken: null, truncated: false, items: [] };
      throw "unexpected";
    } } });
  });
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/app/cluster/customResourcesApi.ts";
    const { loadCustomDefinitions, loadCustomInstances, cancelCustomRead } = await import(/* @vite-ignore */ path);
    (window as any).__customCalls = [];
    const request = { clusterId: "one", sessionId: "session-one", readId: 10, continueToken: "page-token", kind: "secrets", group: "untrusted", spec: "PRIVATE" };
    await loadCustomDefinitions(request);
    await cancelCustomRead(request, true);
    const instances = { ...request, definitionName: "widgets.example.test", definitionUid: "definition-one", namespace: "default" };
    await loadCustomInstances(instances);
    await cancelCustomRead(instances);
    let rejected = false;
    try { await loadCustomDefinitions({ ...request, readId: -1 }); } catch (error) { rejected = error === "invalidInput"; }
    return { calls: (window as any).__customCalls, rejected };
  });
  expect(result.rejected).toBe(true);
  const scope = { clusterId: "one", sessionId: "session-one", readId: 10, continueToken: "page-token" };
  const instanceScope = { ...scope, target: { definitionName: "widgets.example.test", definitionUid: "definition-one" }, namespace: "default" };
  expect(result.calls).toEqual([
    { command: "cluster_custom_resource_definitions", request: scope },
    { command: "cluster_custom_resource_definitions_cancel", request: scope },
    { command: "cluster_custom_resources", request: instanceScope },
    { command: "cluster_custom_resources_cancel", request: instanceScope },
  ]);
});
