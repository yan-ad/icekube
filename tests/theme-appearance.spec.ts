import { expect, test, type Page } from "@playwright/test";
import { defaultPreferences, type AppTheme, type PreferencesSnapshot } from "../src/app/preferences/api";

async function fixture(page: Page, theme: AppTheme, saveFail = false) {
  await page.addInitScript(({ defaults, theme, saveFail }) => {
    const key = "theme-appearance-fixture";
    let snapshot: PreferencesSnapshot = JSON.parse(sessionStorage.getItem(key) ?? "null") ?? {
      revision: 1,
      preferences: { ...defaults, app: { ...defaults.app, theme } },
    };
    Object.assign(window, {
      isTauri: true,
      __prefCalls: [],
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: { request: PreferencesSnapshot }) => {
          if (command === "preferences_get") return snapshot;
          if (command === "preferences_save") {
            if (saveFail) throw "storeUnavailable";
            snapshot = { ...args!.request, revision: snapshot.revision + 1 };
            sessionStorage.setItem(key, JSON.stringify(snapshot));
            return snapshot;
          }
          if (command === "catalog_list") return { revision: 1, clusters: [], webLinks: [], discoveryError: null };
          return null;
        },
      },
    });
  }, { defaults: defaultPreferences, theme, saveFail });
}

async function appearance(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const sample = document.createElement("section");
    sample.style.backgroundColor = "var(--color-background-body)";
    document.body.append(sample);
    const background = getComputedStyle(sample).backgroundColor;
    sample.remove();
    return { mode: document.documentElement.getAttribute("data-theme"), scheme: style.colorScheme, background };
  });
}

async function choose(page: Page, label: string) {
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByRole("combobox", { name: "Color Theme" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

for (const mode of ["light", "dark"] as const) {
  test(`persisted ${mode} overrides the opposite OS mode, including body portals and reload`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.emulateMedia({ colorScheme: mode === "light" ? "dark" : "light" });
    await fixture(page, mode);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await expect(page.locator("html")).toHaveAttribute("data-astryx-theme", "brand");
    const expected = await appearance(page);
    expect(expected.scheme).toBe(mode);
    expect(expected.background).not.toBe("rgba(0, 0, 0, 0)");
    await page.getByRole("button", { name: "Preferences", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.getByRole("dialog").evaluate(element => getComputedStyle(element).colorScheme)).toBe(mode);
    await page.emulateMedia({ colorScheme: mode });
    expect(await appearance(page)).toEqual(expected);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    expect(await appearance(page)).toEqual(expected);
    expect(errors).toEqual([]);
  });
}

test("draft stays unapplied until Save, then Light and Dark apply without reload and persist", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await fixture(page, "dark");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await appearance(page);
  await choose(page, "Light");
  expect(await appearance(page)).toEqual(dark);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const light = await appearance(page);
  expect(light.background).not.toBe(dark.background);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await appearance(page)).toEqual(light);
  await choose(page, "Dark");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await appearance(page)).toEqual(dark);
});

test("saved System follows live OS changes and remains System after reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await fixture(page, "dark");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await appearance(page);
  await choose(page, "System default");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect.poll(async () => (await appearance(page)).background).not.toBe(dark.background);
  const light = await appearance(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => (await appearance(page)).background).toBe(dark.background);
  await page.reload();
  await expect(page.getByRole("button", { name: "Preferences", exact: true })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect.poll(async () => (await appearance(page)).background).toBe(dark.background);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(async () => (await appearance(page)).background).toBe(light.background);
});

test("cancel and failed Save leave the applied theme unchanged", async ({ page }) => {
  await fixture(page, "dark", true);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await choose(page, "Light");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await choose(page, "Light");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Preferences store is temporarily unavailable");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
