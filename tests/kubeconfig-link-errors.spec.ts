import { expect, test } from "@playwright/test";

test("broken kubeconfig links show a safe error without losing existing records", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          if (command === "catalog_import_kubeconfig") throw "inputUnavailable";
          return {
            revision: 1, discoveryError: null,
            clusters: [{ id: "fixture", name: "Development", contextName: "Development", source: "kubeconfig", labels: ["file=/fixtures/original"], color: "#476BA1", status: "disconnected", pinned: true }],
            webLinks: [],
          };
        },
      },
    });
  });
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add config", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Kubeconfig path Required", exact: true }).fill("/fixtures/broken-link");
  await dialog.getByRole("button", { name: "Import contexts", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("symbolic-link target");
  await expect(dialog.getByRole("alert")).not.toContainText("/fixtures/broken-link");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Development", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unpin Development", exact: true })).toBeVisible();
});
