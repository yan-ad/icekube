import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("native navigation is window scoped, subscribes before readiness, validates actions and cleans up", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const calls: string[] = [];
    const handlers = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { handler: number; target: unknown }>();
    let index = 0;
    Object.assign(window, {
      isTauri: true,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => listeners.delete(id) },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "icekube-2" }, currentWebview: { label: "icekube-2" } },
        transformCallback: (callback: (event: unknown) => void) => { const id = ++index; handlers.set(id, callback); return id; },
        invoke: async (command: string, args: { handler?: number; target?: unknown; eventId?: number }) => {
          calls.push(command);
          if (command === "plugin:event|listen") { const id = ++index; listeners.set(id, { handler: args.handler!, target: args.target }); return id; }
          if (command === "plugin:event|unlisten") listeners.delete(args.eventId!);
          if (command === "update_check") return { phase: "disabled", version: null, error: "trustNotConfigured" };
          return null;
        },
      },
    });
    // @ts-expect-error Vite serves source modules for the IPC fixture.
    const api = await import("/src/app/layouts/nativeNavigationApi.ts");
    const actions: string[] = [];
    const dispose = await api.subscribeNativeNavigation((action: string) => actions.push(action));
    const targets = [...listeners.values()].map((listener) => listener.target);
    for (const payload of ["allCategories", "openSearch", "openPreferences", "checkUpdates", "https://evil.test", { to: "/cluster/arbitrary" }]) {
      for (const [id, listener] of listeners) handlers.get(listener.handler)?.({ event: api.NATIVE_NAVIGATION_EVENT, id, payload });
    }
    const update = await api.checkForUpdates();
    dispose();
    return { actions, calls, targets, update, remaining: listeners.size };
  });
  expect(result.actions).toEqual(["allCategories", "openSearch", "openPreferences", "checkUpdates"]);
  expect(result.targets).toEqual([{ kind: "WebviewWindow", label: "icekube-2" }]);
  expect(result.calls.indexOf("plugin:event|listen")).toBeLessThan(result.calls.indexOf("native_navigation_ready"));
  expect(result.update.error).toBe("trustNotConfigured");
  expect(result.remaining).toBe(0);
});

test("browser preview does not invoke native menu APIs", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules for the browser fixture.
    const api = await import("/src/app/layouts/nativeNavigationApi.ts");
    const dispose = await api.subscribeNativeNavigation(() => { throw new Error("unexpected native event"); });
    dispose();
    return await api.checkForUpdates();
  });
  expect(result).toEqual({ phase: "disabled", version: null, error: null });
});

test("native contracts keep fixed destinations, shared chrome, bounded window labels and app-owned icons", () => {
  const menu = readFileSync("src-tauri/src/menu.rs", "utf8");
  const navigation = readFileSync("src-tauri/src/native_navigation.rs", "utf8");
  const windows = readFileSync("src-tauri/src/window.rs", "utf8");
  const project = readFileSync("src-tauri/src/project.rs", "utf8");
  const capabilities = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8"));
  expect(menu).toContain("set_as_help_menu_for_nsapp");
  expect(menu).toContain("Created by Yanuar");
  expect(menu).toContain("default_window_icon()");
  expect(menu).toContain("CmdOrCtrl+N");
  expect(menu).toContain("CmdOrCtrl+K");
  expect(navigation).toContain("snapshot.preferences.app.show_tray_icon");
  expect(navigation).toContain("EventTarget::webview_window(window.label())");
  expect(navigation).not.toContain(".eval(");
  expect(windows).toContain("1..8");
  expect(windows).toContain("initialization_script(layout_script(SEAMLESS");
  expect(capabilities.windows).toEqual(["main", ...Array.from({ length: 7 }, (_, i) => `icekube-${i + 1}`)]);
  expect(project).toContain('const HOMEPAGE_URL: &str = "https://icekube.yan.ad"');
  expect(capabilities.permissions).not.toContain("opener:default");
});
