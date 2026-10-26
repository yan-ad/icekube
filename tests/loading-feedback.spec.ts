import { expect, test, type Page } from "@playwright/test";

type LoadingWindow = Window & { __finishCatalog: () => void; __failCatalog: boolean };
async function fixture(page: Page) {
  await page.addInitScript(() => {
    const target = window as LoadingWindow;
    target.__failCatalog = false;
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          if (command !== "catalog_list") throw "unsupported";
          await new Promise<void>(resolve => { target.__finishCatalog = resolve; });
          if (target.__failCatalog) throw "storeCorrupt";
          return {
            revision: 1, discoveryError: null, webLinks: [],
            clusters: [{ id: "one", name: "Loading fixture", contextName: "fixture", source: "kubeconfig", labels: ["file=/fixtures/config"], color: "#476BA1", status: "disconnected", pinned: false }],
          };
        },
      },
    });
  });
  await page.goto("/#/catalog/all");
}
const finish = (page: Page) => page.evaluate(() => (window as LoadingWindow).__finishCatalog());

test("initial loading is centered below an editable filter, with an accessible spinner", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await fixture(page);
  const spinner = page.getByRole("status", { name: "Loading catalog…", exact: true });
  await expect(spinner).toBeVisible();
  const input = page.getByRole("textbox", { name: "Filter catalog", exact: true });
  await expect(input).toBeEnabled();
  await input.fill("fixture");
  await expect(input).toHaveValue("fixture");
  const inputBox = (await input.boundingBox())!;
  const spinnerBox = (await spinner.boundingBox())!;
  expect(spinnerBox.y).toBeGreaterThan(inputBox.y + inputBox.height);
  const surface = page.locator(".content-loading-initial");
  const box = (await surface.boundingBox())!;
  expect(Math.abs(spinnerBox.x + spinnerBox.width / 2 - box.x - box.width / 2)).toBeLessThan(2);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await finish(page);
  await expect(page.getByRole("cell", { name: "Loading fixture", exact: true })).toBeVisible();
  await expect(spinner).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("refresh keeps rows and input in place under a nonblocking left-to-right bar", async ({ page }) => {
  await fixture(page);
  await finish(page);
  const row = page.getByRole("cell", { name: "Loading fixture", exact: true });
  await expect(row).toBeVisible();
  const before = (await row.boundingBox())!;
  await page.getByRole("button", { name: "Refresh catalog", exact: true }).click();
  const bar = page.getByRole("progressbar", { name: "Loading catalog…", exact: true });
  await expect(bar).toBeVisible();
  await expect(row).toBeVisible();
  const input = page.getByRole("textbox", { name: "Filter catalog", exact: true });
  await input.fill("fixture");
  await expect(input).toHaveValue("fixture");
  await expect(bar).toHaveCSS("pointer-events", "none");
  const after = (await row.boundingBox())!;
  expect(after.y).toBe(before.y);
  const inputBox = (await input.boundingBox())!;
  expect((await bar.boundingBox())!.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await bar.evaluate(element => getComputedStyle(element, "::after").animationName)).toBe("none");
  await finish(page);
  await expect(bar).toHaveCount(0);
  await expect(row).toBeVisible();
});

test("a failed refresh removes progress but preserves the actionable error and saved rows", async ({ page }) => {
  await fixture(page);
  await finish(page);
  await expect(page.getByRole("cell", { name: "Loading fixture", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as LoadingWindow).__failCatalog = true; });
  await page.getByRole("button", { name: "Refresh catalog", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Loading catalog…", exact: true })).toBeVisible();
  await finish(page);
  await expect(page.getByRole("alert")).toContainText("Previously loaded records are still shown.");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Loading fixture", exact: true })).toBeVisible();
});
