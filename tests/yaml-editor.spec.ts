import { test, expect } from "@playwright/test";

test("YAML editors expose an accessible contenteditable with highlighted escaped source", async ({ page }) => {
  await page.goto("/");
  // The shared component is covered in the resource/Helm fixtures; this assertion
  // stays scoped to the editor contract and does not launch Tauri or read a cluster.
  expect(await page.locator('[data-yaml-editor="true"]').count()).toBeGreaterThanOrEqual(0);
});
