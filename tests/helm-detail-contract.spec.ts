import { expect, test } from "@playwright/test";

test("Helm detail parser accepts only the projected closed DTO", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { parseHelmDetail } = await import("/src/app/cluster/helmDetailsApi.ts" as string);
    const request = { clusterId: "cluster", sessionId: "session", readId: 7, view: "charts", name: "stable/demo", namespace: null, version: "1.0.0" } as const;
    const valid = { ...request, facts: [{ label: "Description", value: "line 1\n\tline 2" }, { label: "Empty", value: "" }], history: [], truncated: false };
    const rejected: string[] = [];
    const check = (label: string, value: unknown) => {
      try { parseHelmDetail(value, request); rejected.push(`${label}:accepted`); }
      catch (error) { if (error !== "invalidResponse") rejected.push(`${label}:${String(error)}`); }
    };
    const accepted = parseHelmDetail(valid, request);
    check("top-level", { ...valid, manifest: { private: "PRIVATE" } });

    check("fact-extra", { ...valid, facts: [{ label: "x", value: "ok", raw: "PRIVATE" }] });
    check("history-on-chart", { ...valid, history: [{ revision: 1, updated: "", status: "deployed", chart: "demo", appVersion: "" }] });
    check("control", { ...valid, facts: [{ label: "x", value: "bad\u0000value" }] });
    check("bidi", { ...valid, facts: [{ label: "x", value: "bad\u202Evalue" }] });
    check("surrogate", { ...valid, facts: [{ label: "x", value: "bad\ud800value" }] });
    check("credential", { ...valid, facts: [{ label: "x", value: "token: PRIVATE" }] });
    check("label-newline", { ...valid, facts: [{ label: "x\ny", value: "ok" }] });
    check("empty-label", { ...valid, facts: [{ label: "", value: "ok" }] });
    check("UTF8-field", { ...valid, facts: [{ label: "x", value: "界".repeat(1366) }] });
    check("UTF8-budget", { ...valid, facts: Array.from({ length: 17 }, () => ({ label: "x", value: "😀".repeat(1024) })) });
    const boundary = parseHelmDetail({ ...valid, facts: Array.from({ length: 16 }, () => ({ label: "Label", value: "😀".repeat(1024) })), truncated: true }, request);
    if (boundary.facts.length !== 16) rejected.push("UTF8 boundary rejected");
    for (const key of Object.keys(request)) {
      check(`missing-${key}`, Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key)));
      check(`mismatch-${key}`, { ...valid, [key]: "other" });
    }
    const release = { ...request, view: "releases", name: "demo", namespace: "team-a", version: null };
    const row = { revision: 1, updated: "Thu Oct 29 10:15:00 2026", status: "deployed", chart: "demo-1.0.0", appVersion: "" };
    const response = { ...release, facts: [], history: [row], truncated: false };
    parseHelmDetail(response, release);
    for (const history of [[{ ...row, notes: "PRIVATE" }], [{ ...row, status: "" }], [{ ...row, chart: "" }], [row, row], [{ ...row, updated: "bad\ntext" }], [{ ...row, revision: 4294967296 }]]) {
      try { parseHelmDetail({ ...response, history }, release); rejected.push("history accepted"); }
      catch (error) { if (error !== "invalidResponse") rejected.push(String(error)); }
    }
    const copied = parseHelmDetail(valid, request);
    valid.facts[0].value = "changed";
    if (copied.facts[0].value === "changed") rejected.push("raw alias retained");
    return { accepted, rejected };
  });
  expect(result.accepted.facts[1]).toEqual({ label: "Empty", value: "" });
  expect(result.rejected).toEqual([]);
});


test("runtime requests fail closed before invoking and errors are not rewritten", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { isTauri: true, __calls: 0, __TAURI_INTERNALS__: { invoke: async () => { (window as any).__calls++; throw "helmUnavailable"; } } });
  });
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { loadHelmDetail, cancelHelmDetail } = await import("/src/app/cluster/helmDetailsApi.ts" as string);
    const request = { clusterId: "cluster", sessionId: "session", readId: 7, view: "charts", name: "stable/demo", namespace: null, version: "1.0.0" };
    const failures = [];
    const before = (window as any).__calls;
    for (const input of [null, undefined, [], {}, { ...request, name: null }, { ...request, manifest: "PRIVATE" }, { ...request, readId: NaN }, { ...request, name: `repo/${"x".repeat(129)}` }, { ...request, sessionId: "bad\ud800" }, { ...request, clusterId: "bad\u2066" }]) {
      try { await loadHelmDetail(input); failures.push("accepted request"); }
      catch (error) { if (error !== "invalidInput") failures.push(String(error)); }
    }
    for (const input of [null, {}, request]) {
      try { await cancelHelmDetail(input); failures.push("accepted cancel"); }
      catch (error) { if (error !== "invalidInput") failures.push(String(error)); }
    }
    const unexpectedCalls = (window as any).__calls - before;
    try { await loadHelmDetail(request); failures.push("missing read failure"); }
    catch (error) { if (error !== "helmUnavailable") failures.push(String(error)); }
    return { failures, unexpectedCalls };
  });
  expect(result).toEqual({ failures: [], unexpectedCalls: 0 });
});

test("refresh retains only validated same-scope details and cancels obsolete reads without clearing the new loading owner", async ({ page }) => {
  await page.route("**/__helm_detail_contract", route => route.fulfill({ contentType: "text/html", body: `<html><body><main id="root"></main><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import {HelmDetails} from '/src/app/cluster/HelmDetails.tsx';
    import '/node_modules/@astryxdesign/core/src/reset.css?import';
    import '/node_modules/@astryxdesign/core/dist/astryx.css?import';
    import '/src/app/components/loading-feedback.css?import';
    const root = ReactDOM.createRoot(document.getElementById('root'));
    const onLoadingChange = value => window.loading.push(value);
    window.renderDetail = (revision = 0, name = 'stable/demo', sessionId = 'session') => root.render(React.createElement(HelmDetails, {
      clusterId: 'cluster', sessionId, reference: {view: 'charts', name, namespace: null, version: '1.0.0'}, revision, onLoadingChange
    }));
    window.closeDetail = () => root.render(null);
    window.renderDetail();
  </script></body></html>` }));
  await page.addInitScript(() => {
    const w = window as any;
    w.loading = []; w.calls = []; w.pending = []; w.control = {};
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      const request = structuredClone(args.request); w.calls.push({ command, request });
      if (command === "helm_detail_cancel") return null;
      const control = { ...w.control };
      if (control.hold) await new Promise(resolve => w.pending.push(resolve));
      if (control.fail) throw "raw diagnostic PRIVATE";
      return { ...request, facts: [{ label: "Description", value: control.text ?? "Validated snapshot" }], history: [], truncated: false,
        ...(control.malformed ? { manifest: "PRIVATE" } : {}) };
    } };
  });
  await page.goto("/__helm_detail_contract");
  await expect(page.getByText("Validated snapshot", { exact: true })).toBeVisible();
  await page.evaluate(() => { const w = window as any; w.control = { hold: true, fail: true }; w.renderDetail(1); });
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByText("Validated snapshot", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("may be stale");
  await page.evaluate(() => (window as any).pending.shift()());
  await expect(page.getByRole("alert")).toContainText("last successful snapshot");
  await expect(page.getByRole("alert")).not.toContainText("PRIVATE");
  await expect(page.getByText("Validated snapshot", { exact: true })).toBeVisible();
  await page.evaluate(() => { const w = window as any; w.control = { malformed: true }; });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Validated snapshot", { exact: true })).toBeVisible();
  await page.evaluate(() => { const w = window as any; w.control = { hold: true, text: "obsolete" }; w.renderDetail(2); });
  await expect.poll(() => page.evaluate(() => (window as any).pending.length)).toBe(1);
  await page.evaluate(() => { const w = window as any; w.loading = []; w.control = { hold: true, text: "replacement" }; w.renderDetail(3, "stable/other", "replacement-session"); });
  await expect(page.getByText("Validated snapshot", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).pending.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).loading)).toEqual([true]);
  await page.evaluate(() => (window as any).pending.shift()());
  await expect(page.getByText("obsolete", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).loading)).toEqual([true]);
  await page.evaluate(() => (window as any).pending.shift()());
  await expect(page.getByText("replacement", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).loading)).toEqual([true, false]);
  const calls = await page.evaluate(() => (window as any).calls);
  for (const cancel of calls.filter((call: any) => call.command === "helm_detail_cancel")) {
    expect(calls.some((call: any) => call.command === "helm_detail" && call.request.readId === cancel.request.readId && call.request.sessionId === cancel.request.sessionId)).toBeTruthy();
  }
  await page.evaluate(() => { const w = window as any; w.control = { malformed: true, text: "untrusted" }; w.renderDetail(4, "stable/new"); });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("replacement", { exact: true })).toHaveCount(0);
  await expect(page.getByText("untrusted", { exact: true })).toHaveCount(0);
  await page.evaluate(() => { const w = window as any; w.control = { hold: true, text: "after-close" }; w.renderDetail(5, "stable/closed"); });
  await expect.poll(() => page.evaluate(() => (window as any).pending.length)).toBe(1);
  await page.evaluate(() => (window as any).closeDetail());
  await expect(page.getByText("Loading Helm details…", { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).pending.shift()());
  await expect(page.getByText("after-close", { exact: true })).toHaveCount(0);
});
