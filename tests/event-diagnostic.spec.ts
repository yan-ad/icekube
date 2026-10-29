import { expect, test, type Page } from "@playwright/test";
import { parseEventDiagnostic, type EventDiagnostic } from "../src/app/cluster/eventDiagnostic";

const diagnostic = (message = "Failed scheduling\n\tInsufficient memory"): EventDiagnostic => ({ message, truncated: false, source: "scheduler", fieldPath: "spec.containers{api}" });
function invalid(value: unknown) { expect(() => parseEventDiagnostic(value, "events")).toThrow("invalidResponse"); }

test("Event diagnostics accept legacy absence and reject data on other resource kinds", () => {
  expect(parseEventDiagnostic(undefined, "events")).toBeUndefined();
  for (const kind of ["pods", "secrets", "configMaps", "nodes"] as const) {
    expect(parseEventDiagnostic(undefined, kind)).toBeUndefined();
    expect(parseEventDiagnostic(null, kind)).toBeUndefined();
    expect(() => parseEventDiagnostic(diagnostic(), kind)).toThrow("invalidResponse");
  }
  expect(parseEventDiagnostic(diagnostic(), "events")).toEqual(diagnostic());
  expect(parseEventDiagnostic({ message: "", truncated: false, source: null, fieldPath: null }, "events")?.message).toBe("");
});

test("diagnostic contract rejects unknown, missing, malformed and unsafe fields", () => {
  for (const value of [null, [], "message", { ...diagnostic(), raw: {} }, { ...diagnostic(), truncated: "false" }, { ...diagnostic(), message: {} }, { ...diagnostic(), source: "" }, { ...diagnostic(), fieldPath: [] }]) invalid(value);
  for (const key of Object.keys(diagnostic())) {
    const missing: Record<string, unknown> = { ...diagnostic() }; delete missing[key]; invalid(missing);
  }
  for (const message of ["\u0000", "\u000b", "\r", "\u001b", "\u007f", "\u009f", "\u061c", "\u200e", "\u200f", "\u202e", "\u2066", "\ud800", "\udfff"]) {
    invalid(diagnostic(message));
    invalid({ ...diagnostic(), source: message });
    invalid({ ...diagnostic(), fieldPath: message });
  }
  for (const message of ["Bearer fixture", "Basic fixture", "Authorization: fixture", "password = fixture", '{"client_secret":"fixture"}', "-----BEGIN RSA PRIVATE KEY-----"]) {
    invalid(diagnostic(message)); invalid({ ...diagnostic(), source: message }); invalid({ ...diagnostic(), fieldPath: message });
  }
  expect(parseEventDiagnostic(diagnostic("Failed mount\n[redacted]\nretry"), "events")?.message).toContain("[redacted]");
});

test("UTF-8 byte limits apply per field and cumulatively, not UTF-16 length", () => {
  const exact = { message: "😀".repeat(1536), truncated: true, source: "é".repeat(512), fieldPath: "x".repeat(1024) };
  expect(parseEventDiagnostic(exact, "events")).toEqual(exact);
  invalid({ ...exact, message: exact.message + "a" });
  invalid({ ...exact, source: "é".repeat(513) });
  invalid({ ...exact, fieldPath: "😀".repeat(257) });
  expect(parseEventDiagnostic({ message: "a".repeat(8192), truncated: false, source: null, fieldPath: null }, "events")?.message.length).toBe(8192);
  invalid({ message: "a".repeat(8193), truncated: true, source: null, fieldPath: null });
});

async function mount(page: Page) {
  await page.route("**/__event_diagnostic", route => route.fulfill({ contentType: "text/html", body: `<html><body><main id="root"></main><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import {EventDiagnosticView} from '/src/app/cluster/ResourceEventDiagnostic.tsx';
    import {parseEventDiagnostic} from '/src/app/cluster/eventDiagnostic.ts';
    import '/node_modules/@astryxdesign/core/src/reset.css?import';
    import '/node_modules/@astryxdesign/core/dist/astryx.css?import';
    const root = ReactDOM.createRoot(document.getElementById('root'));
    window.renderDiagnostic = value => root.render(React.createElement(EventDiagnosticView, {diagnostic: parseEventDiagnostic(value, 'events')}));
  </script></body></html>` }));
  await page.goto("/__event_diagnostic");
  await page.waitForFunction(() => typeof (window as any).renderDiagnostic === "function");
}

for (const colorScheme of ["light", "dark"] as const) test(`diagnostic component preserves full multiline plain text and explicit truncation in ${colorScheme}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ colorScheme });
  await mount(page);
  const message = `Failed scheduling\n\t${"insufficient memory; ".repeat(60)}\n<img src=x onerror=alert('fixture')>`;
  await page.evaluate(value => (window as any).renderDiagnostic(value), { ...diagnostic(message), truncated: true });
  const section = page.locator('[aria-label="Cluster diagnostic text"]');
  await expect(section.getByRole("heading", { name: "Cluster diagnostic text" })).toBeVisible();
  await expect(section.getByText("Source: scheduler", { exact: true })).toBeVisible();
  await expect(section.getByText("Field path: spec.containers{api}", { exact: true })).toBeVisible();
  const text = section.getByText(message, { exact: true });
  await expect(text).toBeVisible();
  expect(await text.textContent()).toBe(message);
  expect(await text.evaluate(element => getComputedStyle(element).whiteSpace)).toBe("pre-wrap");
  await expect(section.getByText("Diagnostic text truncated to the display limit.")).toBeVisible();
  await expect(section.locator("img,script,a,button")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 600 });
  await page.evaluate(value => (window as any).renderDiagnostic(value), diagnostic("x".repeat(7000)));
  await expect(section.getByText("x".repeat(7000), { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(value => (window as any).renderDiagnostic(value), { message: "", truncated: false, source: null, fieldPath: null });
  await expect(section.getByText("No diagnostic message provided.")).toBeVisible();
  await expect(section.getByText(/Source:|Field path:|Diagnostic text truncated/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
