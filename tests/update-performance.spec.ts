import { expect, test, type Page } from "@playwright/test";

type Snapshot = {
  phase: string; version: string | null; error: string | null;
  preparationId?: string; progress?: { downloaded: number; total: number } | null;
};
type Probe = {
  __updateProbe: { reads: number; renders: number; ready: number; prepared: number };
  __updateState: Snapshot;
  __unmountProbe: () => void;
  __rerenderParent: () => void;
  __failReady?: boolean;
};

async function setup(page: Page, phase = "idle") {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  await page.addInitScript((phase) => {
    const state = { phase, version: "1.2.3", error: null,
      ...(phase === "downloading" ? { progress: { downloaded: 1, total: 10 } } : {}) };
    const probe = { reads: 0, renders: 0, ready: 0, prepared: 0 };
    Object.assign(window, {
      isTauri: true,
      __ICEON_WINDOW_LAYOUT__: { seamless: true, platform: "macos" },
      __updateProbe: probe, __updateState: state,
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          if (command === "update_state") {
            probe.reads++;
            return structuredClone((window as unknown as Probe).__updateState);
          }
          if (command === "update_window_ready") {
            probe.ready++;
            const fixture = window as unknown as Probe;
            if (fixture.__failReady) { fixture.__failReady = false; throw new Error("fixture report failed"); }
          }
          if (command === "update_window_prepared") probe.prepared++;
          return null;
        },
      },
    });
  }, phase);
  await page.route("**/update-performance-fixture", route => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html><html><body><main id="root"></main><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { createRoot } = ReactDOM;
      const { UpdateProvider, useUpdates, useUpdateBlocker } = await import('/src/app/updates/UpdateProvider.tsx');
      function Probe() {
        const { snapshot, error } = useUpdates();
        useUpdateBlocker(false, 'Fixture is read-only.');
        window.__updateProbe.renders++;
        return React.createElement(React.Fragment, null,
          React.createElement('output', { 'aria-label': 'Update snapshot' }, JSON.stringify(snapshot)),
          React.createElement('output', { 'aria-label': 'Reporting error' }, error ?? 'none'));
      }
      const root = createRoot(document.getElementById('root'));
      window.__unmountProbe = () => root.unmount();
      const MemoProbe = React.memo(Probe);
      function Parent() {
        const [revision, setRevision] = React.useState(0);
        window.__rerenderParent = () => setRevision(value => value + 1);
        return React.createElement('section', { 'data-revision': revision },
          React.createElement(UpdateProvider, null, React.createElement(MemoProbe)));
      }
      root.render(React.createElement(React.StrictMode, null, React.createElement(Parent)));
    </script></body></html>`,
  }));
  await page.goto("/update-performance-fixture");
  await expect(page.getByLabel("Update snapshot")).toContainText(phase);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  return errors;
}

async function counts(page: Page) {
  return page.evaluate(() => ({ ...(window as unknown as Probe).__updateProbe }));
}

async function change(page: Page, patch: Partial<Snapshot>) {
  await page.evaluate(patch => {
    const state = (window as unknown as Probe).__updateState;
    Object.assign(state, patch);
    if (state.phase !== "preparing") delete state.preparationId;
  }, patch);
  await page.clock.runFor(1_100);
}

for (const phase of ["idle", "ready", "downloading"]) {
  test(`${phase}: 120 unchanged polls do not rerender consumers and keep safety heartbeats`, async ({ page }) => {
    const errors = await setup(page, phase);
    await page.clock.runFor(1_100);
    const before = await counts(page);
    for (let i = 0; i < 120; i++) await page.clock.runFor(1_000);
    const after = await counts(page);
    expect(after.reads - before.reads).toBe(120);
    console.log(JSON.stringify({ phase, polls: after.reads - before.reads, consumerRenders: after.renders - before.renders }));
    expect(after.renders - before.renders).toBe(0);
    if (phase === "ready") expect(after.ready - before.ready).toBeGreaterThanOrEqual(120);
    else expect(after.ready).toBe(0);
    await page.evaluate(() => (window as unknown as Probe).__unmountProbe());
    const stopped = await counts(page);
    await page.clock.runFor(5_000);
    expect((await counts(page)).reads).toBe(stopped.reads);
    expect(errors).toEqual([]);
  });
}

test("unrelated parent renders keep the update context stable", async ({ page }) => {
  const errors = await setup(page);
  await page.clock.runFor(1_100);
  const before = await counts(page);
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => (window as unknown as Probe).__rerenderParent());
    await expect(page.locator("[data-revision]")).toHaveAttribute("data-revision", String(i + 1));
  }
  expect((await counts(page)).renders).toBe(before.renders);
  expect(errors).toEqual([]);
});

test("an identical successful poll still clears a prior reporting error", async ({ page }) => {
  const errors = await setup(page, "ready");
  await page.clock.runFor(1_100);
  const before = await counts(page);
  await page.evaluate(() => { (window as unknown as Probe).__failReady = true; });
  await page.clock.runFor(1_000);
  await expect(page.getByLabel("Reporting error")).toContainText("readiness could not be reported");
  await page.clock.runFor(1_000);
  await expect(page.getByLabel("Reporting error")).toHaveText("none");
  expect((await counts(page)).renders).toBeGreaterThan(before.renders);
  expect(errors).toEqual([]);
});

test("phase, version, progress, errors and preparation identities still update consumers", async ({ page }) => {
  const errors = await setup(page);
  const output = page.getByLabel("Update snapshot");
  for (const patch of [
    { phase: "checking" },
    { phase: "downloading", progress: { downloaded: 1, total: 10 } },
    { progress: { downloaded: 2, total: 10 } },
    { progress: { downloaded: 2, total: 20 } },
    { progress: null },
    { version: "1.2.4" },
    { phase: "error", error: "verificationFailed" },
    { error: "downloadFailed" },
    { error: null, phase: "ready" },
    { phase: "preparing", preparationId: "0123456789abcdef0123456789abcdef" },
    { preparationId: "abcdef0123456789abcdef0123456789" },
    { phase: "restarting" },
    { phase: "idle" },
  ] satisfies Partial<Snapshot>[]) {
    const before = await counts(page);
    await change(page, patch);
    await expect.poll(async () => (await counts(page)).renders).toBeGreaterThan(before.renders);
    for (const [key, value] of Object.entries(patch)) {
      const rendered = JSON.parse(await output.textContent() ?? "null");
      expect(rendered[key]).toEqual(value);
    }
    if (patch.phase === "preparing") await expect(page.locator("#root")).toHaveAttribute("inert", "");
    if (patch.phase === "idle") await expect(page.locator("#root")).not.toHaveAttribute("inert");
  }
  expect((await counts(page)).prepared).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
