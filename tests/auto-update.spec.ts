import { expect, test, type Page } from "@playwright/test";
import { defaultPreferences } from "../src/app/preferences/api";
import { readFileSync } from "node:fs";

type Call = { command: string; ready?: boolean; attempt?: string; inert?: boolean };
async function fixture(page: Page, phase = "ready", error: string | null = null, workspace = false) {
  await page.addInitScript(({ phase, error, preferences, workspace }) => {
    const calls: Call[] = [];
    Object.assign(window, {
      isTauri: true,
      __ICEON_WINDOW_LAYOUT__: { seamless: true, platform: "macos" },
      __updateCalls: calls,
      __updatePhase: phase,
      __updateAttempt: "0123456789abcdef0123456789abcdef",
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback: () => 1,
        invoke: async (command: string, args?: { ready?: boolean; attempt?: string; request?: Record<string, unknown> }) => {
          calls.push({ command, ready: args?.ready, attempt: args?.attempt, inert: (document.getElementById("root") ?? document.querySelector<HTMLElement>("[data-update-admission]"))?.inert });

          if (command === "update_window_prepared" && (window as unknown as { __holdPrepared?: boolean }).__holdPrepared) await new Promise<void>(resolve => Object.assign(window, { __releasePrepared: resolve }));
          if (command === "update_state" || command === "update_check") {
            const state = window as unknown as { __updatePhase: string; __updateAttempt: string };
            return { phase: state.__updatePhase, version: "1.2.3", error, ...(state.__updatePhase === "preparing" ? { preparationId: state.__updateAttempt } : {}) };
          }
          if (command === "preferences_get") return { revision: 1, preferences };
          if (command === "catalog_list") return { revision: 1, clusters: workspace ? [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] : [], webLinks: [], discoveryError: null };
          const request = args?.request ?? {};
          if (command === "catalog_connection_states") return [];
          if (command === "cluster_session_open" || command === "cluster_connect") return { ...request, sessionId: request.sessionId ?? "fixture-session", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
          if (command === "cluster_permissions_review") {
            const review = request as unknown as import("../src/app/cluster/permissionsApi").PermissionReviewRequest;
            return { clusterId: review.clusterId, sessionId: review.sessionId, readId: review.readId, authorizationEpoch: "fixture-epoch", revision: review.readId, checkedAt: Date.now(), expiresAt: Date.now() + 30000, items: review.checks.map(check => ({ check, decision: "allowed", reason: null })) };
          }
          if (command === "cluster_resources" || command === "cluster_custom_resource_definitions") return { ...request, namespace: request.namespace ?? null, kind: command === "cluster_custom_resource_definitions" ? "customResourceDefinitions" : request.kind, items: [], continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null };
          return null;
        },
      },
    });
  }, { phase, error, preferences: defaultPreferences, workspace });
}

async function blockerFixture(page: Page) {
  await fixture(page);
  await page.route("**/update-blocker-fixture", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html>
    <html><body><main id="fixture"></main><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { createRoot } = ReactDOM;
      const { Theme } = await import('/node_modules/.vite/deps/@astryxdesign_core_theme.js');
      const { brandTheme } = await import('/src/themes/brand.ts');
      const { UpdateProvider, useUpdateBlocker } = await import('/src/app/updates/UpdateProvider.tsx');
      function Work({ active }) {
        useUpdateBlocker(active, 'Fixture editing is open.');
        return React.createElement('section', { hidden: true }, 'Retained work');
      }
      function Harness() {
        const [active, setActive] = React.useState(false);
        const [mounted, setMounted] = React.useState(true);
        return React.createElement(React.Fragment, null,
          React.createElement('button', { onClick: () => setActive(value => !value) }, 'Toggle work'),
          React.createElement('button', { onClick: () => setMounted(value => !value) }, 'Toggle mount'),
          React.createElement('input', { 'aria-label': 'Search resources', type: 'search' }),
          mounted && React.createElement(Work, { active }));
      }
      createRoot(document.getElementById('fixture')).render(React.createElement(React.StrictMode, null,
        React.createElement(Theme, { theme: brandTheme }, React.createElement(UpdateProvider, null, React.createElement(Harness)))));
    </script></body></html>` }));
  await page.goto("/update-blocker-fixture");
  await expect(page.getByRole("button", { name: "Toggle work" })).toBeVisible();
}

test("registered work remains unsafe when hidden, changes immediately, and releases on disposal", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await blockerFixture(page);
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.getByRole("searchbox", { name: "Search resources" }).fill("pod");
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.getByRole("button", { name: "Toggle work" }).click();
  await expect.poll(() => lastReady(page)).toBe(false);
  await page.getByRole("button", { name: "Toggle work" }).click();
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.getByRole("button", { name: "Toggle work" }).click();
  await expect.poll(() => lastReady(page)).toBe(false);
  await page.getByRole("button", { name: "Toggle mount" }).click();
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.getByRole("button", { name: "Toggle mount" }).click();
  await expect.poll(() => lastReady(page)).toBe(false);
  expect(errors).toEqual([]);
});

test("active-work owners register lifecycle blockers without blocking read-only Pod details", () => {
  const source = (file: string) => readFileSync(new URL(`../src/app/cluster/${file}.tsx`, import.meta.url), "utf8");
  for (const [file, component] of [["ResourceCreate", "CreateEditor"], ["ResourceDelete", "DeleteConfirmation"], ["HelmInstall", "InstallEditor"], ["ManagedUserEditor", "ManagedUserEditor"]]) {
    expect(source(file).slice(source(file).indexOf(`function ${component}(`))).toMatch(/useUpdateBlocker\(true, /);
  }
  expect(source("PodDetailsView")).toContain('useUpdateBlocker(edit, "Pod YAML editing is open.")');
  expect(source("PodDock")).toContain('useUpdateBlocker(tabs.some(tab => ["logs", "shell", "attach", "forward"].includes(tab.mode))');
  expect(source("PodDock")).toContain('useUpdateBlocker(confirm !== null || busy,');
});
async function lastReady(page: Page) {
  return page.evaluate(() => (window as unknown as { __updateCalls: Call[] }).__updateCalls.filter(call => call.command === "update_window_ready").at(-1)?.ready);
}

test("verified updates report window safety without manual download or install actions", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  const status = page.getByRole("status", { name: "Update verified; installs automatically when work is safe.", exact: true });
  await expect(status).toBeVisible();
  await expect(status).toContainText("Update verified; installs automatically when work is safe.");
  await expect.poll(() => lastReady(page)).toBe(true);
  await expect(page.getByRole("button", { name: /Restart to Update|Download update|Show download/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __updateCalls: Call[] }).__updateCalls.some(call => ["update_download", "update_reveal", "update_restart"].includes(call.command)))).toBe(false);
});

test("dialogs and hidden editable drafts pause installation; dismissing and removing drafts resumes readiness", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.evaluate(() => { const dialog = document.createElement("dialog"); dialog.id = "update-test-dialog"; dialog.textContent = "Unsaved operation"; document.body.append(dialog); dialog.showModal(); });
  await expect.poll(() => lastReady(page)).toBe(false);
  await page.evaluate(() => document.getElementById("update-test-dialog")?.remove());
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.evaluate(() => { const editor = document.createElement("section"); editor.id = "update-test-editor"; editor.contentEditable = "true"; editor.hidden = true; document.body.append(editor); });
  await expect.poll(() => lastReady(page)).toBe(false);
  await page.evaluate(() => document.getElementById("update-test-editor")?.setAttribute("aria-readonly", "true"));
  // Read-only YAML does not hold a window lease unsafe.
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.evaluate(() => document.getElementById("update-test-editor")?.setAttribute("contenteditable", "plaintext-only"));
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.evaluate(() => document.getElementById("update-test-editor")?.removeAttribute("aria-readonly"));
  await expect.poll(() => lastReady(page)).toBe(false);
});

test("blurred dirty fields remain unsafe while search text does not prevent automatic updates", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.evaluate(() => { const input = document.createElement("input"); input.id = "update-test-input"; input.setAttribute("aria-label", "Account name"); document.body.append(input); });
  await page.locator("#update-test-input").fill("unsaved account");
  await page.locator("#update-test-input").blur();
  await expect.poll(() => lastReady(page)).toBe(false);
  await page.evaluate(() => document.getElementById("update-test-input")?.remove());
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.evaluate(() => { const input = document.createElement("input"); input.id = "update-test-search"; input.setAttribute("aria-label", "Search resources"); document.body.append(input); });
  await page.locator("#update-test-search").fill("pod");
  await expect.poll(() => lastReady(page)).toBe(true);
});

test("background windows do not ignore explicit unsaved-work markers", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    const draft = document.createElement("section"); draft.id = "update-test-draft"; draft.hidden = true; draft.dataset.updateBlocking = "true"; document.body.append(draft);
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => lastReady(page)).toBe(false);
  await page.evaluate(() => document.getElementById("update-test-draft")?.remove());
  await expect.poll(() => lastReady(page)).toBe(true);
});

for (const phase of ["idle", "checking", "downloading", "disabled", "error", "stopped"]) {
  test(`${phase} does not authorize installation`, async ({ page }) => {
    await fixture(page, phase);
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __updateCalls: Call[] }).__updateCalls.some(call => call.command === "update_state"))).toBe(true);
    expect(await lastReady(page)).toBeUndefined();
  });
}

test("installation failure is accessible and does not claim completion", async ({ page }) => {
  await fixture(page, "error", "installFailed");
  await page.goto("/");
  await expect(page.getByRole("alert", { name: "Update error" })).toContainText("could not be installed");
});

test("opening the real resource creation editor blocks ready updates until dismissal", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await fixture(page, "ready", null, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/cluster/one?section=priority-classes");
  const create = page.getByRole("button", { name: /^Create / }).first();
  await expect(create).toBeVisible();
  await expect.poll(() => lastReady(page)).toBe(true);
  await create.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => lastReady(page)).toBe(false);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => lastReady(page)).toBe(true);
  expect(errors).toEqual([]);
});

async function transition(page: Page, phase: string, attempt = "0123456789abcdef0123456789abcdef") {
  await page.evaluate(({ phase, attempt }) => Object.assign(window, { __updatePhase: phase, __updateAttempt: attempt }), { phase, attempt });
}
async function lastPrepared(page: Page) {
  return page.evaluate(() => (window as unknown as { __updateCalls: Call[] }).__updateCalls.filter(call => call.command === "update_window_prepared").at(-1));
}

test("preparation freezes before receipts and blocks root and portal input through restarting", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.evaluate(() => {
    const portal = document.createElement("button"); portal.id = "portal-work"; portal.textContent = "Portal work";
    document.body.append(portal);
    Object.assign(window, { __workEvents: 0 });
    for (const name of ["mousedown", "pointerdown", "click", "keydown", "beforeinput", "input", "submit", "focusin"]) {
      portal.addEventListener(name, () => { (window as unknown as { __workEvents: number }).__workEvents++; });
    }
  });
  await transition(page, "preparing");
  await expect.poll(() => lastPrepared(page)).toMatchObject({ ready: true, inert: true, attempt: "0123456789abcdef0123456789abcdef" });
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  for (const phase of ["preparing", "restarting"]) {
    await transition(page, phase);
    if (phase === "restarting") await expect(page.locator("#root")).toContainText("Installing update and restarting");
    await page.evaluate(() => {
      for (const name of ["mousedown", "pointerdown", "click", "keydown", "beforeinput", "input", "submit", "focusin"]) document.getElementById("portal-work")!.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }));
    });
    expect(await page.evaluate(() => (window as unknown as { __workEvents: number }).__workEvents)).toBe(0);
  }
  await transition(page, "ready");
  await expect(page.locator("#root")).not.toHaveAttribute("inert");
  await page.locator("#portal-work").click();
  expect(await page.evaluate(() => (window as unknown as { __workEvents: number }).__workEvents)).toBeGreaterThan(0);
});

test("a draft entered after idle readiness refuses preparation and survives failure thaw", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.evaluate(() => {
    const input = document.createElement("input"); input.id = "pending-draft"; input.setAttribute("aria-label", "Account name"); document.getElementById("root")!.append(input);
  });
  await page.locator("#pending-draft").fill("keep this draft");
  await transition(page, "preparing");
  await expect.poll(() => lastPrepared(page)).toMatchObject({ ready: false, inert: true });
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  await page.waitForTimeout(1100);
  expect((await lastPrepared(page))?.ready).toBe(false);
  await transition(page, "error");
  await expect(page.locator("#root")).not.toHaveAttribute("inert");
  await expect(page.locator("#pending-draft")).toHaveValue("keep this draft");
});

test("a new attempt waits for the previous receipt without stale replies thawing admission", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.evaluate(() => Object.assign(window, { __holdPrepared: true }));
  await transition(page, "preparing");
  await expect.poll(() => lastPrepared(page)).toMatchObject({ ready: true, inert: true });
  const second = "abcdef0123456789abcdef0123456789";
  await transition(page, "preparing", second);
  await page.waitForTimeout(1200);
  expect((await lastPrepared(page))?.attempt).not.toBe(second);
  await page.evaluate(() => {
    Object.assign(window, { __holdPrepared: false });
    (window as unknown as { __releasePrepared: () => void }).__releasePrepared();
  });
  await expect.poll(() => lastPrepared(page)).toMatchObject({ ready: true, inert: true, attempt: second });
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  await transition(page, "stopped");
  await expect(page.locator("#root")).not.toHaveAttribute("inert");
});

test("malformed preparation snapshots revoke the exact receipt and restore prior inert state", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await expect.poll(() => lastReady(page)).toBe(true);
  await page.evaluate(() => document.getElementById("root")!.setAttribute("inert", "prior"));
  await transition(page, "preparing");
  await expect.poll(() => lastPrepared(page)).toMatchObject({ ready: true, inert: true });
  await transition(page, "preparing", "invalid");
  await expect.poll(() => lastPrepared(page)).toMatchObject({ ready: false, attempt: "0123456789abcdef0123456789abcdef" });
  await expect(page.locator("#root")).toHaveAttribute("inert", "prior");
});

test("initial preparation is quiescent and an open portal dialog refuses its receipt", async ({ page }) => {
  await fixture(page, "preparing");
  await page.goto("/");
  await expect.poll(() => lastPrepared(page)).toMatchObject({ ready: true, inert: true });
  expect(await lastReady(page)).toBeUndefined();
  await page.evaluate(() => {
    const dialog = document.createElement("dialog"); dialog.id = "retained-dialog";
    const draft = document.createElement("textarea"); draft.value = "unsaved YAML"; dialog.append(draft);
    document.body.append(dialog); dialog.showModal();
  });
  await expect.poll(() => lastPrepared(page)).toMatchObject({ ready: false, inert: true });
  await transition(page, "ready");
  await expect(page.locator("#root")).not.toHaveAttribute("inert");
  await expect(page.locator("#retained-dialog textarea")).toHaveValue("unsaved YAML");
  await expect.poll(() => lastReady(page)).toBe(false);
});
