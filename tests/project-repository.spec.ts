import { expect, test } from "@playwright/test";

for (const failure of [false, true]) {
  test(`GitHub uses a fixed no-argument native command${failure ? " and reports safe failures" : ""}`, async ({ page }) => {
    await page.addInitScript(failure => {
      Object.assign(window, { isTauri: true, __projectCalls: [], __TAURI_INTERNALS__: {
        invoke: async (command: string, args: unknown) => {
          if (command === "catalog_list") return { revision: 1, clusters: [], webLinks: [], discoveryError: null };
          if (command === "project_open_repository") {
            (window as unknown as { __projectCalls: unknown[] }).__projectCalls.push({ command, args });
            if (failure) throw "private platform diagnostics";
          }
          return null;
        },
      } });
    }, failure);
    await page.goto("/");
    const github = page.getByRole("button", { name: "Open Icekube on GitHub", exact: true });
    await expect(github).toBeVisible();
    await github.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __projectCalls: unknown[] }).__projectCalls)).toEqual([{ command: "project_open_repository", args: {} }]);
    if (failure) {
      await expect(page.getByRole("alert")).toContainText("The GitHub repository could not be opened");
      await expect(page.getByRole("alert")).not.toContainText("private platform diagnostics");
    }
    await expect(github).toBeEnabled();
    await expect(page).toHaveURL(/catalog/);
  });
}

test("browser preview keeps GitHub visible without native or external opening", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto("/");
  const github = page.getByRole("button", { name: "Open Icekube on GitHub", exact: true });
  await expect(github).toBeVisible();
  await expect(github).toBeDisabled();
  await expect(github).toHaveAttribute("aria-description", "GitHub repository opens in the desktop app only");
  const more = page.getByRole("button", { name: "Toolbar actions", exact: true });
  const githubBox = await github.boundingBox();
  const moreBox = await more.boundingBox();
  expect(githubBox!.x + githubBox!.width).toBeLessThanOrEqual(moreBox!.x);
  await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);
});
