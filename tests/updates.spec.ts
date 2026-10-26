import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, phase = "ready", fail = false) {
  await page.addInitScript(({ phase, fail }) => {
    const calls: string[] = [];
    Object.assign(window, {
      isTauri: true, __updateCalls: calls,
      __TAURI_INTERNALS__: { invoke: async (command: string) => {
        calls.push(command);
        if (command === "update_state") return { phase, version: phase === "ready" ? "1.2.3" : null, error: null };
        if (command === "update_restart") {
          await new Promise(resolve => setTimeout(resolve, 300));
          if (fail) throw "installFailed";
          return;
        }
        if (command === "catalog_list") return { revision: 1, clusters: [], webLinks: [], discoveryError: null };
        return;
      } },
    });
  }, { phase, fail });
}

test("only staged verified readiness offers restart; duplicate restart is disabled", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  const button = page.getByRole("button", { name: "Restart to Update", exact: true });
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute("aria-disabled", "true");
  expect(await page.evaluate(() => (window as unknown as { __updateCalls: string[] }).__updateCalls.filter(c => c === "update_restart").length)).toBe(1);
});
for (const phase of ["idle", "checking", "downloading", "disabled", "error"]) {
  test(`${phase} is not ready`, async ({ page }) => {
    await fixture(page, phase);
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __updateCalls: string[] }).__updateCalls.includes("update_state"))).toBe(true);
    await expect(page.getByRole("button", { name: "Restart to Update", exact: true })).toHaveCount(0);
  });
}
test("restart failure is accessible and does not claim success", async ({ page }) => {
  await fixture(page, "ready", true);
  await page.goto("/");
  await page.getByRole("button", { name: "Restart to Update", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Update error" })).toContainText("could not be installed");
});
test("browser preview never calls updater IPC or shows restart", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Restart to Update", exact: true })).toHaveCount(0);
});
