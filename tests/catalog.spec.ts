import { expect, test, type Page } from "@playwright/test";

async function engineFixture(page: Page, options: { empty?: boolean; failList?: boolean; slow?: boolean } = {}) {
  await page.addInitScript((options) => {
    const initial = { revision: 1, clusters: options.empty ? [] : [{ id: "cluster-fixture", name: "Development", contextName: "Development", source: "fixture.yaml", status: "disconnected", pinned: false }], webLinks: options.empty ? [] : [{ id: "link-fixture", name: "Documentation", url: "https://docs.example.test/", pinned: false }] };
    const read = () => JSON.parse(sessionStorage.getItem("test.catalog") ?? JSON.stringify(initial));
    const calls: { command: string; request: unknown }[] = [];
    Object.assign(window, {
      isTauri: true,
      __catalogCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
          const request = args?.request ?? {};
          calls.push({ command, request });

          if (options.slow) await new Promise((resolve) => setTimeout(resolve, 300));
          if (options.failList && command === "catalog_list") throw "storeCorrupt";
          const state = read();
          if (command === "catalog_import_kubeconfig") {
            if (request.path === "/invalid.yaml") throw "invalidKubeconfig";
            state.clusters.push({ id: "cluster-import", name: "Imported context", contextName: "Imported context", source: "import.yaml", status: "disconnected", pinned: false });
          } else if (command === "catalog_add_web_link") {
            if (String(request.url).includes("?")) throw "invalidInput";
            state.webLinks.push({ id: "link-added", name: request.name, url: request.url, pinned: false });
          } else if (command === "catalog_set_pin") {
            const item = [...state.clusters, ...state.webLinks].find((item: { id: string }) => item.id === request.id);
            if (!item) throw "notFound";
            item.pinned = request.pinned;
          } else if (command === "catalog_remove") {
            state.clusters = state.clusters.filter((item: { id: string }) => item.id !== request.id);
            state.webLinks = state.webLinks.filter((item: { id: string }) => item.id !== request.id);
          } else if (command !== "catalog_list") throw "unsupported";
          if (command !== "catalog_list") state.revision++;
          sessionStorage.setItem("test.catalog", JSON.stringify(state));
          return state;
        },
      },
    });
  }, options);
  await page.setViewportSize({ width: 1100, height: 700 });
}

test("All Categories combines records; category filters and legacy redirect work", async ({ page }, testInfo) => {
  await engineFixture(page);
  await page.goto("/");
  const all = page.getByRole("table", { name: "All Categories", exact: true });
  await expect(all.getByRole("cell", { name: "Development", exact: true })).toBeVisible();
  await expect(all.getByRole("cell", { name: "Documentation", exact: true })).toBeVisible();
  await expect(all.getByRole("cell", { name: "Disconnected", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("catalog-desktop.png") });
  await page.getByRole("link", { name: "Clusters", exact: true }).click();
  const clusters = page.getByRole("table", { name: "Clusters", exact: true });
  await expect(clusters.getByRole("cell", { name: "Development", exact: true })).toBeVisible();
  await expect(clusters.getByRole("cell", { name: "Documentation", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Web Links", exact: true }).click();
  await expect(page.getByRole("table", { name: "Web links", exact: true }).getByRole("cell", { name: "Documentation", exact: true })).toBeVisible();
  await page.goto("/#/catalog/general");
  await expect(page).toHaveURL(/#\/catalog\/all$/);
  await expect(page.getByRole("heading", { name: "All Categories", level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "General", exact: true })).toHaveCount(0);
});

test("individual row pins persist and sidebar reflects them; categories never have pin actions", async ({ page }) => {
  await engineFixture(page);
  await page.goto("/");
  const table = page.getByRole("table", { name: "All Categories", exact: true });
  await table.getByRole("button", { name: "Pin Development", exact: true }).click();
  await expect(page.getByRole("link", { name: "Development", exact: true })).toBeVisible();
  await page.reload();
  await expect(table.getByRole("button", { name: "Unpin Development", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Development", exact: true }).click();
  await expect(page).toHaveURL(/catalog\/clusters\?item=cluster-fixture$/);
  await expect(page.getByRole("cell", { name: "Development", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show all clusters", exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog\/clusters$/);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await table.getByRole("button", { name: "Unpin Development", exact: true }).click();
  await expect(page.getByRole("link", { name: "Development", exact: true })).toHaveCount(0);
  for (const name of ["All Categories", "Clusters", "Web Links"]) await expect(page.getByRole("button", { name: `Pin ${name}`, exact: true })).toHaveCount(0);
  await expect(table.getByRole("button", { name: "Pin Development", exact: true }).locator("svg")).toHaveCount(0);
});

test("explicit import and add link populate the combined list; remove confirms local scope", async ({ page }) => {
  await engineFixture(page, { empty: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your catalog is empty", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import kubeconfig", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Kubeconfig path Required", exact: true }).fill("/fixtures/import.yaml");
  await dialog.getByRole("button", { name: "Import contexts", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Imported context", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add web link", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Name Required", exact: true }).fill("Team dashboard");
  await dialog.getByRole("textbox", { name: "URL Required", exact: true }).fill("https://dashboard.example.test/");
  await dialog.getByRole("button", { name: "Save web link", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("textbox", { name: "Filter catalog", exact: true }).fill("unmatched");
  await expect(page.getByRole("heading", { name: "No matching items", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Filter catalog", exact: true }).fill("");
  await page.getByRole("button", { name: "Remove Team dashboard", exact: true }).click();
  await expect(dialog).toContainText("The kubeconfig, cluster, and website will not be changed.");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Team dashboard", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove Team dashboard", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove from catalog", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Team dashboard", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("cell", { name: "Imported context", exact: true })).toBeVisible();
});

test("invalid imports stay in dialog with safe errors and preserve records", async ({ page }) => {
  await engineFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Import kubeconfig", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Kubeconfig path Required", exact: true }).fill("/invalid.yaml");
  await dialog.getByRole("button", { name: "Import contexts", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("not a valid kubeconfig");
  await expect(dialog.getByRole("alert")).not.toContainText("/invalid.yaml");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Development", exact: true })).toBeVisible();
});

test("loading and corrupt storage are distinct from an empty catalog", async ({ page }) => {
  await engineFixture(page, { failList: true, slow: true });
  await page.goto("/#/catalog");
  await expect(page.getByRole("status").filter({ hasText: "Loading catalog…" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("has not been overwritten");
  await expect(page.getByRole("heading", { name: "Catalog unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import kubeconfig", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh catalog", exact: true })).toBeEnabled();
});

test("browser fallback disables persistence without inventing records", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Desktop engine required", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add web link", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("desktop app only");
});


test("failed refresh retains the last loaded records and redacts unknown errors", async ({ page }) => {
  await engineFixture(page);
  await page.goto("/");
  await expect(page.getByRole("cell", { name: "Development", exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __TAURI_INTERNALS__: { invoke: () => Promise<never> } }).__TAURI_INTERNALS__.invoke = async () => { throw "SECRET_TOKEN fixture error"; };
  });
  await page.getByRole("button", { name: "Refresh catalog", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Previously loaded records are still shown");
  await expect(page.getByRole("alert")).not.toContainText("SECRET_TOKEN");
  await expect(page.getByRole("cell", { name: "Development", exact: true })).toBeVisible();
});

test("populated catalog stays inside narrow and enlarged-text viewports", async ({ page }, testInfo) => {
  await engineFixture(page);
  await page.goto("/");
  await expect(page.getByRole("cell", { name: "Development", exact: true })).toBeVisible();
  for (const width of [360, 800]) {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "All Categories", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.screenshot({ path: testInfo.outputPath("catalog-enlarged.png") });
});
