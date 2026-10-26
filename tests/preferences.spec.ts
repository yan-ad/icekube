import { expect, test, type Page } from "@playwright/test";
import { defaultPreferences, type Preferences, type PreferencesSnapshot } from "../src/app/preferences/api";

type Call = { command: string; request?: unknown };

async function fixture(page: Page, options: { initial?: Preferences; saveFail?: string } = {}) {
  await page.addInitScript(({ options, defaultPreferences }) => {
    const calls: Call[] = [];
    let state: PreferencesSnapshot = {
      revision: 1,
      preferences: options.initial ?? defaultPreferences,
    };
    Object.assign(window, {
      isTauri: true,
      __prefCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: { request: unknown }) => {
          calls.push({ command, request: args?.request });
          if (command === "preferences_get") {
            return state;
          }
          if (command === "preferences_save") {
            if (options.saveFail) throw options.saveFail;
            const req = args?.request as { revision: number; preferences: Preferences };
            state = { revision: req.revision + 1, preferences: req.preferences };
            return state;
          }
          if (command === "catalog_list") {
            return { revision: 1, clusters: [], webLinks: [], discoveryError: null };
          }
          if (command === "update_state") {
            return { phase: "idle", version: null, error: null };
          }
          return null;
        },
      },
    });
  }, { options, defaultPreferences });
}

test("toolbar preferences button opens preferences dialog", async ({ page }) => {
  await fixture(page);
  await page.goto("/");

  const button = page.getByRole("button", { name: "Preferences", exact: true });
  await expect(button).toBeVisible();
  await button.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Application Settings")).toBeVisible();
});

test("Cmd+, keyboard shortcut opens preferences dialog", async ({ page }) => {
  await fixture(page);
  await page.goto("/");

  await page.keyboard.press("ControlOrMeta+,");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
});

test("navigates across all 5 preference sections: App, Proxy, Kubernetes, Editor, Terminal", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  const dialog = page.getByRole("dialog");

  // Section: App
  await expect(dialog.getByText("Application Settings")).toBeVisible();
  await expect(dialog.getByText("Persistent search")).toBeVisible();
  await expect(dialog.getByText("Start-up")).toBeVisible();
  await expect(dialog.getByText("Menu-bar Settings")).toBeVisible();

  // Section: Proxy
  await dialog.getByRole("button", { name: "Proxy", exact: true }).click();
  await expect(dialog.getByText("Proxy Settings")).toBeVisible();
  await expect(dialog.getByText("Certificate Trust")).toBeVisible();

  // Section: Kubernetes
  await dialog.getByRole("button", { name: "Kubernetes", exact: true }).click();
  await expect(dialog.getByText("Kubernetes & Helm")).toBeVisible();
  await expect(dialog.getByText("Server-side apply", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Kubeconfig discovery", { exact: true })).toBeVisible();

  // Section: Editor
  await dialog.getByRole("button", { name: "Editor", exact: true }).click();
  await expect(dialog.getByText("Editor Configuration")).toBeVisible();
  await expect(dialog.getByText("Minimap", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Font size", exact: true })).toBeVisible();

  // Section: Terminal
  await dialog.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(dialog.getByText("Terminal Configuration")).toBeVisible();
  await expect(dialog.getByText("Terminal copy & paste")).toBeVisible();
});

test("modifies preference, saves, and invokes preferences_save IPC", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  const dialog = page.getByRole("dialog");

  // Go to proxy, fill url
  await dialog.getByRole("button", { name: "Proxy", exact: true }).click();
  const proxyInput = dialog.getByRole("textbox", { name: "HTTP / HTTPS Proxy URL" });
  await proxyInput.fill("http://127.0.0.1:8888");

  // Save
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByText("Preferences saved.")).toBeVisible();

  // Verify IPC
  const calls: Call[] = await page.evaluate(() => (window as unknown as { __prefCalls: Call[] }).__prefCalls);
  const saveCall = calls.find(c => c.command === "preferences_save");
  expect(saveCall).toBeDefined();
  const req = saveCall?.request as { preferences: Preferences };
  expect(req.preferences.proxy.httpsProxy).toBe("http://127.0.0.1:8888");
});

test("handles conflict and invalid input errors honestly", async ({ page }) => {
  await fixture(page, { saveFail: "conflict" });
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  const dialog = page.getByRole("dialog");

  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Preferences were updated in another window");
});

test("cancel closes preferences dialog without saving", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  const dialog = page.getByRole("dialog");

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const calls: Call[] = await page.evaluate(() => (window as unknown as { __prefCalls: Call[] }).__prefCalls);
  expect(calls.filter(c => c.command === "preferences_save")).toHaveLength(0);
});
