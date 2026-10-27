import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("browser document and application search use Iceon", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Iceon");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Search Iceon", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search Iceon", exact: true })).toHaveCount(0);
});

test("native search keeps the compatible event contract and opens Iceon search", async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let index = 0;
    Object.assign(window, {
      isTauri: true,
      __ICEON_WINDOW_LAYOUT__: { seamless: false, platform: "linux" },
      __brandingReady: false,
      __brandingSearch: () => {
        for (const [id, listener] of listeners) {
          if (listener.event === "iceon://native-navigation") {
            callbacks.get(listener.handler)?.({ event: listener.event, id, payload: "openSearch" });
          }
        }
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener: (_event: string, id: number) => listeners.delete(id),
      },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback: (callback: (event: unknown) => void) => {
          const id = ++index;
          callbacks.set(id, callback);
          return id;
        },
        invoke: async (command: string, args?: { event?: string; handler?: number; eventId?: number }) => {
          if (command === "plugin:event|listen") {
            const id = ++index;
            listeners.set(id, { event: args!.event!, handler: args!.handler! });
            return id;
          }
          if (command === "plugin:event|unlisten") listeners.delete(args!.eventId!);
          if (command === "native_navigation_ready") Object.assign(window, { __brandingReady: true });
          if (command === "catalog_list") return { revision: 1, clusters: [], webLinks: [], discoveryError: null };
          return null;
        },
      },
    });
  });
  await page.goto("/");
  await expect(page).toHaveTitle("Iceon");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __brandingReady: boolean }).__brandingReady)).toBe(true);
  await page.evaluate(() => (window as unknown as { __brandingSearch: () => void }).__brandingSearch());
  await expect(page.getByRole("dialog", { name: "Search Iceon", exact: true })).toBeVisible();
});

test("native branding preserves icons, window IDs and fixed project destinations", () => {
  const menu = readFileSync("src-tauri/src/menu.rs", "utf8");
  const navigation = readFileSync("src-tauri/src/native_navigation.rs", "utf8");
  const project = readFileSync("src-tauri/src/project.rs", "utf8");
  expect(menu).toContain('app_menu.set_text("Iceon")');
  expect(menu).toContain('Some("About Iceon")');
  expect(menu).toContain('name: Some("Iceon".into())');
  expect(menu).toContain('"Search Iceon"');
  expect(menu).toContain("app.default_window_icon().cloned()");
  expect(navigation).toContain('.tooltip("Iceon")');
  expect(navigation).toContain('"iceon://native-navigation"');
  expect(navigation).toContain('"iceon-navigation"');
  expect(project).toContain('"https://github.com/yan-ad/iceon"');
  expect(project).toContain('"https://iceon.yan.ad"');
});
