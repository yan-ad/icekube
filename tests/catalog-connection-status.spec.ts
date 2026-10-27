import { expect, test, type Page } from "@playwright/test";

type Control = { status: string; malformed?: boolean; holdStatus?: boolean; holdDisconnect?: boolean; holdCatalog?: boolean };
type Fixture = Window & { __connectionControl: Control; __releaseStatus: () => void; __releaseDisconnect: () => void; __releaseCatalog: () => void; __connectionCalls: string[] };
async function fixture(page: Page, status = "connected") {
  page.on("pageerror", error => { throw error; });

  await page.addInitScript(status => {
    const control: Control = { status };
    const pending: (() => void)[] = [], disconnects: (() => void)[] = [], catalogs: (() => void)[] = [], calls: string[] = [];
    const cluster = (id: string, name: string, status: string) => ({ id, name, contextName: id, source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status });
    Object.assign(window, { isTauri: true, __connectionControl: control, __connectionCalls: calls,
      __releaseStatus: () => pending.splice(0).forEach(resolve => resolve()),
      __releaseCatalog: () => { control.holdCatalog = false; catalogs.splice(0).forEach(resolve => resolve()); },
      __releaseDisconnect: () => { control.holdDisconnect = false; disconnects.splice(0).forEach(resolve => resolve()); },
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Record<string, any> }) => {
        calls.push(command);
        const request = args?.request ?? {};
        if (command.startsWith("catalog_") && command !== "catalog_connection_states") {
          const snapshot = { revision: 1, discoveryError: null,
          clusters: [cluster("one", "Development", control.status), cluster("two", "Staging", "disconnected")],
          webLinks: [{ id: "docs", name: "Documentation", url: "https://example.test", source: "local", labels: [], color: "#476BA1", pinned: false }] };
          if (control.holdCatalog) await new Promise<void>(resolve => catalogs.push(resolve));
          return snapshot;
        }
        if (command === "catalog_connection_states") {
          const captured = control.status;
          if (control.holdStatus) await new Promise<void>(resolve => pending.push(resolve));
          if (control.malformed) return [{ clusterId: "one", status: "connected", credential: "PRIVATE" }];
          return captured === "disconnected" ? [] : [{ clusterId: "one", status: captured }];
        }
        if (command === "cluster_session_open") return { clusterId: request.clusterId, sessionId: crypto.randomUUID(), contextName: request.clusterId, status: "disconnected", apiVersion: null, error: null };
        if (command === "cluster_connect") { control.status = "connected"; return { ...request, contextName: request.clusterId, status: "connected", apiVersion: "v1.35.8", error: null }; }
        if (command === "cluster_disconnect") {
          if (control.holdDisconnect) await new Promise<void>(resolve => disconnects.push(resolve));
          control.status = "disconnected"; return null;
        }
        if (command.endsWith("_cancel")) return null;
        throw "invalidInput";
      } },
    });
  }, status);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/catalog/all");
}
const row = (page: Page, name = "Development") => page.getByRole("row", { name: `Open cluster ${name}`, exact: true });
const control = (page: Page, next: Partial<Control>) => page.evaluate(next => Object.assign((window as Fixture).__connectionControl, next), next);

test("Catalog uses observed runtime status, not imported metadata or hardcoded Disconnected", async ({ page }) => {
  await fixture(page);
  await expect(row(page).locator("[data-variant=success]", { hasText: "Connected" })).toHaveAttribute("data-variant", "success");
  await expect(row(page, "Staging")).toContainText("Disconnected");
  await expect(page.getByRole("row", { name: "Open web link Documentation", exact: true })).toContainText("Not checked");
  await expect.poll(() => page.evaluate(() => (window as Fixture).__connectionCalls.includes("catalog_connection_states"))).toBe(true);
  await control(page, { status: "connecting" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(row(page)).toContainText("Connecting…");
  await control(page, { status: "error" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(row(page).locator("[data-variant=error]", { hasText: "Connection error" })).toHaveAttribute("data-variant", "error");
  await control(page, { status: "disconnected" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(row(page)).toContainText("Disconnected");
  const calls = await page.evaluate(() => (window as Fixture).__connectionCalls);
  expect(calls.filter(command => command.startsWith("cluster_"))).toEqual([]);
});

test("failed or malformed runtime read becomes Unknown, never a fabricated disconnected success", async ({ page }) => {
  await fixture(page);
  await expect(row(page)).toContainText("Connected");
  await control(page, { malformed: true });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(row(page)).toContainText("Unknown");
  await expect(page.getByRole("table")).not.toContainText("PRIVATE");
  await control(page, { malformed: false });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(row(page)).toContainText("Connected");
});

test("late status reply cannot resurrect a released workspace connection", async ({ page }) => {
  await fixture(page, "disconnected");
  await row(page).getByRole("cell", { name: "kubeconfig", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cluster actions", exact: true })).toHaveAttribute("aria-description", "Connection status: Connected");
  await control(page, { holdStatus: true, holdDisconnect: true });
  await page.getByRole("navigation", { name: "Catalog navigation", exact: true }).getByRole("link", { name: "All Categories", exact: true }).click();
  await expect(row(page)).toContainText("Disconnecting…");
  await expect.poll(() => page.evaluate(() => (window as Fixture).__connectionCalls.includes("catalog_connection_states"))).toBe(true);
  await page.evaluate(() => (window as Fixture).__releaseDisconnect());
  await expect(row(page)).toContainText("Disconnected");
  await page.evaluate(() => (window as Fixture).__releaseStatus());
  await expect(row(page)).toContainText("Disconnected");
  await expect(row(page).getByText("Connected", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as Fixture).__connectionCalls.filter(command => command === "cluster_connect").length)).toBe(1);
});

test("late Catalog mutation cannot overwrite a newer disconnected runtime observation", async ({ page }) => {
  await fixture(page);
  await expect(row(page)).toContainText("Connected");
  await expect.poll(() => page.evaluate(() => (window as Fixture).__connectionCalls.includes("catalog_connection_states"))).toBe(true);
  await control(page, { holdCatalog: true });
  await row(page).getByRole("button", { name: "Pin Development", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Fixture).__connectionCalls.includes("catalog_set_pin"))).toBe(true);
  await control(page, { status: "disconnected" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(row(page)).toContainText("Disconnected");
  // Prevent a corrective poll from concealing an older mutation's bad overwrite.
  await control(page, { holdStatus: true });
  await page.evaluate(() => (window as Fixture).__releaseCatalog());
  await expect(row(page).getByRole("button", { name: "Pin Development", exact: true })).toBeEnabled();
  await expect(row(page)).toContainText("Disconnected");
  await expect(row(page).getByText("Connected", { exact: true })).toHaveCount(0);
});
