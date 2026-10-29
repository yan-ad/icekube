import { expect, test, type Page } from "@playwright/test";
import { defaultPreferences, type Preferences, type PreferencesSnapshot } from "../src/app/preferences/api";

for (const action of ["Save changes", "Reset to defaults"]) {
  test(`late ${action} completion does not affect a reopened dialog`, async ({ page }) => {
    const main = await (await page.request.get("/src/main.tsx")).text();
    const reactPath = main.match(/from ["']([^"']*\/react\.js(?:\?[^"']*)?)["']/)?.[1];
    const domPath = main.match(/from ["']([^"']*\/react-dom_client\.js(?:\?[^"']*)?)["']/)?.[1];
    expect(reactPath).toBeTruthy();
    expect(domPath).toBeTruthy();
    await page.route("**/preferences-harness", route => route.fulfill({
      contentType: "text/html",
      body: `<main id="root"></main><script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        const { default: React } = await import(${JSON.stringify(reactPath)});
        const { default: ReactDOM } = await import(${JSON.stringify(domPath)});
        const { createRoot } = ReactDOM;
        const { PreferencesProvider, usePreferences } = await import('/src/app/preferences/PreferencesProvider.tsx');
        const { PreferencesDialog } = await import('/src/app/preferences/PreferencesDialog.tsx');
        function Harness() {
          const preferences = usePreferences();
          window.__preferenceLifecycle = preferences;
          return React.createElement(PreferencesDialog);
        }
        createRoot(document.getElementById('root')).render(
          React.createElement(PreferencesProvider, null, React.createElement(Harness)));
      </script>`,
    }));
    await page.goto("/preferences-harness");
    await page.waitForFunction(() => "__preferenceLifecycle" in window);
    const lifecycle = (method: "openPreferences" | "closePreferences") => page.evaluate(method => {
      (window as unknown as { __preferenceLifecycle: Record<string, () => void> }).__preferenceLifecycle[method]();
    }, method);
    await lifecycle("openPreferences");
    const dialog = page.getByRole("dialog", { name: "Preferences" });
    await page.evaluate(() => {
      (window as unknown as { __preferenceControls: { pending: boolean } }).__preferenceControls.pending = true;
    });
    await dialog.getByRole("button", { name: action, exact: true }).click();
    await lifecycle("closePreferences");
    await expect(dialog).toHaveCount(0);
    await lifecycle("openPreferences");
    await dialog.getByRole("button", { name: "Proxy", exact: true }).click();
    const input = dialog.getByRole("textbox", { name: "HTTP / HTTPS Proxy URL" });
    await input.fill("http://127.0.0.1:8888");
    await page.evaluate(() => (window as unknown as { __resolvePreferenceOperation: () => void }).__resolvePreferenceOperation());
    await page.waitForTimeout(650);
    await expect(dialog).toBeVisible();
    await expect(input).toHaveValue("http://127.0.0.1:8888");
    await expect(dialog.getByText("Preferences saved.", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  });
}
test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(({ defaults }) => {
    let state: PreferencesSnapshot = { revision: 1, preferences: defaults };
    const pending: Array<() => void> = [];
    const calls: string[] = [];
    const controls = { pending: false, failure: "" };
    let resolveLoad: () => void = () => undefined;
    const load = new URLSearchParams(location.search).has("holdPreferences")
      ? new Promise<void>(resolve => { resolveLoad = resolve; })
      : Promise.resolve();
    Object.assign(window, {
      __prefCalls: calls,
      __preferenceControls: controls,
      __resolvePreferenceLoad: () => {
        state = { revision: 2, preferences: { ...defaults, proxy: { ...defaults.proxy, httpsProxy: "http://127.0.0.1:9999" } } };
        resolveLoad();
      },
      __resolvePreferenceOperation: () => pending.splice(0).forEach(resolve => resolve()),
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback: () => 1,
        invoke: (command: string, args?: { request?: unknown }) => {
          calls.push(command);
          if (command === "preferences_get") return load.then(() => state);
          if (command === "catalog_list") return Promise.resolve({ revision: 1, clusters: [], webLinks: [], discoveryError: null });

          if (command === "update_state") return Promise.resolve({ phase: "idle", version: null, error: null });
          if (command !== "preferences_save") return Promise.resolve(null);
          const request = args?.request as { revision: number; preferences: Preferences };
          const operation = controls.pending
            ? new Promise<void>(resolve => pending.push(resolve))
            : Promise.resolve();
          return operation.then(() => {
            if (controls.failure) return Promise.reject(controls.failure);
            state = { revision: request.revision + 1, preferences: request.preferences };
            return state;
          });
        },
      },
    });
  }, { defaults: defaultPreferences });
});

async function open(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  return page.getByRole("dialog", { name: "Preferences" });
}

test("late snapshot initialization preserves an open draft and initializes the next opening", async ({ page }) => {
  await page.goto("/?holdPreferences");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Preferences" });
  await dialog.getByRole("button", { name: "Proxy", exact: true }).click();
  const input = dialog.getByRole("textbox", { name: "HTTP / HTTPS Proxy URL" });
  await input.fill("http://127.0.0.1:8888");
  await page.evaluate(() => (window as unknown as { __resolvePreferenceLoad: () => void }).__resolvePreferenceLoad());
  await expect(input).toHaveValue("http://127.0.0.1:8888");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(input).toHaveValue("http://127.0.0.1:9999");
});

test("save success remains visible without an auto-close timer", async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Preferences saved." })).toBeVisible();
  await page.waitForTimeout(650);
  await expect(dialog).toBeVisible();
});

test("save conflict keeps the edited draft visible", async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => {
    (window as unknown as { __preferenceControls: { failure: string } }).__preferenceControls.failure = "conflict";
  });
  await dialog.getByRole("button", { name: "Proxy", exact: true }).click();
  const input = dialog.getByRole("textbox", { name: "HTTP / HTTPS Proxy URL" });
  await input.fill("http://127.0.0.1:8888");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Preferences were updated in another window");
  await expect(input).toHaveValue("http://127.0.0.1:8888");
});

test("reset remains pending and closes only after its completion", async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => {
    (window as unknown as { __preferenceControls: { pending: boolean } }).__preferenceControls.pending = true;
  });
  await dialog.getByRole("button", { name: "Reset to defaults", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Color Theme" })).toBeDisabled();
  await page.evaluate(() => (window as unknown as { __resolvePreferenceOperation: () => void }).__resolvePreferenceOperation());
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
});

test("pending save blocks dismissal and reopening after success has no stale timer", async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => {
    (window as unknown as { __preferenceControls: { pending: boolean } }).__preferenceControls.pending = true;
  });
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(dialog.getByText("Preferences saved.", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as unknown as { __resolvePreferenceOperation: () => void }).__resolvePreferenceOperation());
  await expect(dialog.getByRole("status").filter({ hasText: "Preferences saved." })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.waitForTimeout(650);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Preferences saved.", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
});
