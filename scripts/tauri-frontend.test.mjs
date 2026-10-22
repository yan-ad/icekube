/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const frontend = process.env.FREELENS_TAURI_FRONTEND;
assert.ok(frontend, "Run through pnpm test:tauri so the browser entry is built");
const html = await readFile(join(frontend, "index.html"), "utf8");
const entry = html.match(/<script[^>]+src="\.\/([^"]+)"/);
assert.ok(entry, "HTML must load the compiled browser entry");
const compiled = await build({
  entryPoints: [join(frontend, entry[1])],
  bundle: true,
  format: "iife",
  write: false,
});
const source = compiled.outputFiles[0].text;

const status = {
  protocolVersion: 1,
  runtime: "node",
  nodeVersion: process.versions.node,
  processId: 42,
  userData: "/isolated/Freelens",
  sessionData: "/isolated/Freelens",
  phases: ["before-anything", "before-host-ready", "host-ready", "application-started"],
};

const boot = (t, invoke, light = false) => {
  const dom = new JSDOM(html, { url: "https://tauri.localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const errors = [];
  dom.window.addEventListener("error", (event) => errors.push(event.message));
  const preference = {
    matches: light,
    addEventListener: (_, listener) => {
      preference.change = listener;
    },
  };
  dom.window.matchMedia = () => preference;
  if (invoke) dom.window.__TAURI__ = { core: { invoke } };
  dom.window.eval(source);
  return { document: dom.window.document, errors, preference };
};

async function waitFor(predicate) {
  for (let count = 0; count < 200; count++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Browser entry did not reach the expected state");
}

for (const light of [false, true]) {
  test(`renders the existing Welcome view before readiness (${light ? "light" : "dark"})`, async (t) => {
    const calls = [];
    let document;
    const app = boot(
      t,
      async (command) => {
        calls.push(command);
        if (command === "runtime_status") return status;
        assert.equal(command, "runtime_ready");
        assert.ok(document.querySelector('[data-testid="welcome-page"]'));
        assert.equal(document.querySelector("h2").textContent, "Welcome to Freelens!");
        assert.ok(document.querySelector(".logo svg"));
      },
      light,
    );
    document = app.document;
    await waitFor(() => calls.includes("runtime_ready"));
    assert.deepEqual(calls, ["runtime_status", "runtime_ready"]);
    assert.deepEqual(app.errors, []);
    assert.equal(document.body.classList.contains("theme-light"), light);
    assert.equal(document.documentElement.style.getPropertyValue("--mainBackground"), light ? "#f1f1f1" : "#1e2124");
    assert.match(
      document.body.textContent,
      /Cluster discovery, catalog actions, terminals, and extensions are not connected yet/,
    );
    const details = document.querySelector("details");
    assert.ok(details);
    details.open = true;
    assert.match(details.textContent, /\/isolated\/Freelens/);
    app.preference.matches = !light;
    app.preference.change();
    assert.equal(document.body.classList.contains("theme-light"), !light);
  });
}

test("shows loading until the host responds", async (t) => {
  const app = boot(t, () => new Promise(() => {}));
  await waitFor(() => app.document.querySelector('[role="status"]'));
  assert.equal(app.document.querySelector('[data-testid="welcome-page"]'), null);
});

test("surfaces backend failure without signaling readiness", async (t) => {
  const calls = [];
  const app = boot(t, async (command) => {
    calls.push(command);
    throw new Error("Backend unavailable");
  });
  await waitFor(() => app.document.querySelector('[role="alert"]'));
  assert.match(app.document.body.textContent, /Backend unavailable/);
  assert.deepEqual(calls, ["runtime_status"]);
});

test("reports missing Tauri instead of a blank window", async (t) => {
  const app = boot(t);
  await waitFor(() => app.document.querySelector('[role="alert"]'));
  assert.match(app.document.body.textContent, /Tauri host is unavailable/);
});

test("surfaces a rejected readiness command", async (t) => {
  const app = boot(t, async (command) => {
    if (command === "runtime_status") return status;
    throw new Error("Readiness denied");
  });
  await waitFor(() => app.document.querySelector('[role="alert"]'));
  assert.match(app.document.body.textContent, /Readiness denied/);
});

test("bundles local styles and fonts without Node or Electron runtime imports", async () => {
  assert.doesNotMatch(source, /require\(["'](?:node:|electron)/);
  const stylesheet = html.match(/<link[^>]+href="\.\/([^"]+\.css)"/);
  assert.ok(stylesheet);
  const css = await readFile(join(frontend, stylesheet[1]), "utf8");
  assert.match(css, /\.Welcome/);
  assert.match(css, /font-family:Roboto/);
  const font = css.match(/url\([^)]*\/([^/)]+\.ttf)\)/);
  assert.ok(font);
  assert.ok((await readFile(join(frontend, "assets", font[1]))).length > 0);
});
