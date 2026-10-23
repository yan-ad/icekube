/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("opens the full cluster sidebar and Pods without starting authentication", async (t) => {
  const calls = [];
  const app = boot(
    t,
    async (command) => {
      calls.push(command);
      if (command === "runtime_status") return status;
      if (command === "catalog_snapshot") return catalogSnapshot;
      assert.equal(command, "runtime_ready");
    },
    false,
    "#/catalog",
  );
  await waitFor(() => app.document.querySelector(`[data-testid="catalog-entity-${cluster.id}"]`));
  app.document.querySelector(`[aria-label="Open ${cluster.name}"]`).click();
  await waitFor(() => app.document.querySelector('[aria-label="Cluster navigation"]'));
  assert.equal(app.window.location.hash, `#/cluster/${encodeURIComponent(cluster.id)}`);
  assert.match(app.document.body.textContent, /SOON/);
  assert.match(app.document.body.textContent, /Load Pods/);
  assert.match(app.document.body.textContent, /may execute kubeconfig auth plugins/);
  assert.doesNotMatch(app.document.body.textContent, /Authentication proxy started|Starting connection|Connecting…/);
  const navigation = app.document.querySelector('[aria-label="Cluster navigation"]');
  assert.ok(
    [...navigation.querySelectorAll("button")]
      .filter((button) => button.disabled)
      .every((button) => button.textContent.includes("SOON")),
  );
  [...app.document.querySelectorAll("button")].find((button) => button.textContent === "Back to Catalog").click();
  await waitFor(() => app.document.querySelector('[aria-label="Catalog entities"]'));
  assert.equal(app.window.location.hash, "#/catalog");
  assert.ok(calls.every((command) => ["runtime_status", "catalog_snapshot", "runtime_ready"].includes(command)));
  assert.deepEqual(app.errors, []);
});

test("readiness does not depend on animation frames in an unfocused webview", async (t) => {
  let ready = false;
  const app = boot(t, async (command) => {
    if (command === "runtime_status") return status;
    if (command === "catalog_snapshot") return catalogSnapshot;
    if (command === "runtime_ready") {
      assert.ok(app.document.querySelector('[data-testid="welcome-page"]'));
      ready = true;
    }
  });
  app.window.requestAnimationFrame = () => 1;
  await waitFor(() => ready);
});

for (const light of [false, true]) {
  test(`navigates Welcome → real backend Catalog → Home (${light ? "light" : "dark"})`, async (t) => {
    const app = boot(
      t,
      async (command) => {
        if (command === "runtime_status") return status;
        if (command === "catalog_snapshot") return catalogSnapshot;
        assert.equal(command, "runtime_ready");
      },
      light,
    );
    await waitFor(() => app.document.querySelector('[data-testid="welcome-page"]'));
    [...app.document.querySelectorAll("li")]
      .find((item) => item.textContent.includes("Browse Clusters in Catalog"))
      .click();
    await waitFor(() => app.document.querySelector('[data-testid="catalog-entity-catalog-entity"]'));
    assert.equal(app.window.location.hash, "#/catalog");
    assert.match(app.document.body.textContent, /Welcome Page/);
    assert.match(app.document.body.textContent, /fixture-cluster/);
    assert.match(app.document.body.textContent, /Preferences/);
    app.document.querySelector('[data-testid="entity.k8slens.dev/General-tab"]').click();
    assert.match(app.document.body.textContent, /Welcome Page/);
    const input = app.document.querySelector('[aria-label="Search catalog"]');
    const setValue = Object.getOwnPropertyDescriptor(app.window.HTMLInputElement.prototype, "value").set;
    setValue.call(input, "not present");
    input.dispatchEvent(new app.window.Event("input", { bubbles: true }));
    await waitFor(() => app.document.body.textContent.includes("No catalog entities found."));
    assert.equal(app.document.querySelector('[data-testid="catalog-entity-welcome-page-entity"]'), null);
    app.document.querySelector('[data-testid="home-button"]').click();
    await waitFor(() => app.document.querySelector('[data-testid="welcome-page"]'));
    assert.equal(app.window.location.hash, "#/welcome");
    assert.deepEqual(app.errors, []);
  });
}

test("deep-linked Catalog waits for its snapshot before signaling readiness", async (t) => {
  let resolveSnapshot;
  let ready = false;
  const app = boot(
    t,
    async (command) => {
      if (command === "runtime_status") return status;
      if (command === "catalog_snapshot")
        return new Promise((resolve) => {
          resolveSnapshot = resolve;
        });
      assert.equal(command, "runtime_ready");
      assert.ok(app.document.querySelector('[data-testid="catalog-entity-catalog-entity"]'));
      ready = true;
    },
    false,
    "#/catalog",
  );
  await waitFor(() => resolveSnapshot);
  assert.match(app.document.body.textContent, /Loading catalog/);
  assert.equal(ready, false);
  resolveSnapshot(catalogSnapshot);
  await waitFor(() => ready);
});

test("Catalog errors remain recoverable and malformed snapshots are not rendered", async (t) => {
  let attempts = 0;
  const app = boot(
    t,
    async (command) => {
      if (command === "runtime_status") return status;
      if (command === "catalog_snapshot") {
        attempts++;
        return attempts === 1 ? { ...catalogSnapshot, scope: "untrusted" } : catalogSnapshot;
      }
    },
    false,
    "#/catalog",
  );
  await waitFor(() => app.document.querySelector('[role="alert"]'));
  assert.equal(app.document.querySelector('[data-testid="catalog-entity-catalog-entity"]'), null);
  [...app.document.querySelectorAll("button")].find((button) => button.textContent === "Retry").click();
  await waitFor(() => app.document.querySelector('[data-testid="catalog-entity-catalog-entity"]'));
  assert.equal(attempts, 2);
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

// Exercise the browser contract against actual backend providers, not invented cluster rows.
const backend = spawnSync(process.execPath, [process.env.FREELENS_TAURI_BACKEND], {
  input: `${JSON.stringify({ id: 1, method: "initialize", appData: process.env.FREELENS_TAURI_PROFILE })}\n${JSON.stringify({ id: 2, method: "catalog.snapshot" })}\n`,
  encoding: "utf8",
  timeout: 5000,
});
assert.equal(backend.status, 0, backend.stderr);
const catalogSnapshot = JSON.parse(backend.stdout.trim().split("\n")[1]).result;
assert.equal(catalogSnapshot.protocolVersion, 2);
assert.equal(catalogSnapshot.scope, "local");
assert.equal(catalogSnapshot.categories.length, 3);
assert.deepEqual(
  new Set(catalogSnapshot.entities.filter(({ source }) => source === "app").map(({ id }) => id)),
  new Set(["welcome-page-entity", "catalog-entity", "preferences-entity"]),
);
const cluster = catalogSnapshot.entities.find(({ kind }) => kind === "KubernetesCluster");
assert.equal(cluster?.name, "fixture-cluster");
assert.equal(cluster.status, "disconnected");
assert.doesNotMatch(backend.stdout + backend.stderr, /tauri-discovery-sentinel|writeFileSync/);

const boot = (t, invoke, light = false, hash = "") => {
  const dom = new JSDOM(html, {
    url: `https://tauri.localhost/${hash}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
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
  return { document: dom.window.document, errors, preference, window: dom.window };
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
    assert.deepEqual(calls, ["runtime_status", "catalog_snapshot", "runtime_ready"]);
    assert.deepEqual(app.errors, []);
    assert.equal(document.body.classList.contains("theme-light"), light);
    assert.equal(document.documentElement.style.getPropertyValue("--mainBackground"), light ? "#f1f1f1" : "#1e2124");
    assert.ok(document.querySelector(".ClusterManager .HotbarMenu"));
    assert.ok(document.querySelector('[data-testid="status-bar"]'));
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
