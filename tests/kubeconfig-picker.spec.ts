import { expect, test, type Page } from "@playwright/test";

type PickerFixture = { calls: { command: string; args: unknown }[]; resolve: (path: unknown) => void; reject: (reason: unknown) => void };
async function setup(page: Page, importError: string | null = null) {
  await page.addInitScript((importError) => {
    const fixture: PickerFixture = { calls: [], resolve: () => {}, reject: () => {} };
    Object.assign(window, { isTauri: true, __picker: fixture, __TAURI_INTERNALS__: {
      invoke: async (command: string, args: unknown) => {
        if (command === "catalog_choose_kubeconfig") {
          fixture.calls.push({ command, args });
          return new Promise((resolve, reject) => { fixture.resolve = resolve; fixture.reject = reject; });
        }
        if (command === "catalog_import_kubeconfig") {
          fixture.calls.push({ command, args });
          if (importError) throw importError;
        }
        if (command.startsWith("catalog_")) return { revision: 1, clusters: [], webLinks: [], discoveryError: null };
        return null;
      },
    } });
  }, importError);
  await page.goto("/");
  await page.getByRole("button", { name: "Add config", exact: true }).click();
}
const pathInput = (page: Page) => page.getByRole("textbox", { name: "Kubeconfig path Required", exact: true });
const choose = (page: Page) => page.getByRole("button", { name: "Choose File", exact: true });
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __picker: PickerFixture }).__picker.calls);
const resolve = (page: Page, path: unknown) => page.evaluate(path => (window as unknown as { __picker: PickerFixture }).__picker.resolve(path), path);

test("selection preserves a Unicode symlink path and imports only after confirmation", async ({ page }) => {
  await setup(page);
  await choose(page).focus();
  await page.keyboard.press("Enter");
  await expect(choose(page)).toBeDisabled();
  await choose(page).dispatchEvent("click");
  await expect.poll(() => calls(page)).toEqual([{ command: "catalog_choose_kubeconfig", args: {} }]);
  await resolve(page, "/fixtures/集群 config-link");
  await expect(pathInput(page)).toHaveValue("/fixtures/集群 config-link");
  expect(await calls(page)).toHaveLength(1);
  await page.getByRole("button", { name: "Import contexts", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await calls(page)).toEqual([
    { command: "catalog_choose_kubeconfig", args: {} },
    { command: "catalog_import_kubeconfig", args: { request: { path: "/fixtures/集群 config-link" } } },
  ]);
});

test("native cancellation preserves the manual path and picker is reusable", async ({ page }) => {
  await setup(page);
  await pathInput(page).fill("/fixtures/manual");
  await choose(page).click();
  await resolve(page, null);
  await expect(pathInput(page)).toHaveValue("/fixtures/manual");
  await expect(choose(page)).toBeEnabled();
  await choose(page).click();
  await resolve(page, "/fixtures/retry");
  await expect(pathInput(page)).toHaveValue("/fixtures/retry");
});

for (const reject of [false, true]) {
  test(`late picker ${reject ? "failure" : "selection"} cannot affect a reopened form`, async ({ page }) => {
    await setup(page);
    await choose(page).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: "Add config", exact: true }).click();
    await pathInput(page).fill("/fixtures/new-session");
    await page.evaluate(reject => {
      const fixture = (window as unknown as { __picker: PickerFixture }).__picker;
      if (reject) fixture.reject("private platform error"); else fixture.resolve("/fixtures/obsolete");
    }, reject);
    await expect(pathInput(page)).toHaveValue("/fixtures/new-session");
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
    await expect(choose(page)).toBeEnabled();
  });
}

test("safe picker failure allows retry without leaking platform diagnostics", async ({ page }) => {
  await setup(page);
  await choose(page).click();
  await page.evaluate(() => (window as unknown as { __picker: PickerFixture }).__picker.reject("secret platform path"));
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("The file dialog could not be opened");
  await expect(page.getByRole("dialog")).not.toContainText("secret platform path");
  await choose(page).click();
  await resolve(page, "/fixtures/retry");
  await expect(pathInput(page)).toHaveValue("/fixtures/retry");
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
});

test("import limits remain Rust errors, not routine form copy", async ({ page }) => {
  await setup(page, "limitExceeded");
  await expect(page.getByRole("dialog")).not.toContainText("1 MiB");
  await expect(pathInput(page)).not.toHaveAttribute("aria-describedby", /.+/);
  await pathInput(page).fill("/fixtures/too-large");
  await page.getByRole("button", { name: "Import contexts", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("1 MiB");
  await expect(pathInput(page)).toHaveValue("/fixtures/too-large");
});

test("browser preview cannot launch native file selection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Add config", exact: true })).toBeDisabled();
  await expect(choose(page)).toHaveCount(0);
});
