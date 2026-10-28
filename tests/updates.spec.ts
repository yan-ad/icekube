import { expect, test } from "@playwright/test";

test("updater snapshots accept only automatic lifecycle phases and bounded public fields", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules for the IPC fixture.
    const api = await import("/src/app/updates/api.ts");
    const valid = ["disabled", "idle", "checking", "downloading", "ready", "preparing", "restarting", "error", "stopped"].map(phase => api.parseUpdateSnapshot({ phase, version: "1.2.3", error: null, ...(phase === "preparing" ? { preparationId: "0123456789abcdef0123456789abcdef" } : {}) }));
    const invalid = [
      { phase: "available", version: "1.2.3", error: null },
      { phase: "downloaded", version: "1.2.3", error: null },
      { phase: "ready", version: null, error: null },
      { phase: "ready", version: "1.2.3", error: "secret backend details" },
      { phase: "ready", version: "1.2.3", error: null, assetName: "installer.dmg" },
      { phase: "downloading", version: "1.2.3", error: null, progress: { downloaded: 2, total: 1 } },
      { phase: "preparing", version: "1.2.3", error: null },
      { phase: "preparing", version: "1.2.3", error: null, preparationId: "not-an-attempt" },
      { phase: "preparing", version: null, error: null, preparationId: "0123456789abcdef0123456789abcdef" },
      { phase: "ready", version: "1.2.3", error: null, preparationId: "0123456789abcdef0123456789abcdef" },
    ].map(value => { try { api.parseUpdateSnapshot(value); return false; } catch { return true; } });
    return { valid, invalid, disabled: api.disabledUpdateSnapshot };
  });
  expect(result.valid).toHaveLength(9);
  expect(result.invalid).toEqual(Array(10).fill(true));
  expect(result.disabled).toEqual({ phase: "disabled", version: null, error: null });
});

test("browser preview never invokes readiness or updater IPC", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules for the IPC fixture.
    const api = await import("/src/app/updates/api.ts");
    await api.reportUpdateWindowReady(true);
    await api.reportUpdateWindowPrepared("0123456789abcdef0123456789abcdef", true);
    return await api.readUpdateState();
  })).toEqual({ phase: "disabled", version: null, error: null });
  await expect(page.getByRole("button", { name: /Restart to Update|Download update|Show download/ })).toHaveCount(0);
});
