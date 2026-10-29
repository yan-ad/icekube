import { defineConfig } from "@playwright/test";

const production = process.env.ICEON_TEST_PRODUCTION === "1";
const baseURL = production ? "http://127.0.0.1:1422" : "http://127.0.0.1:1420";

export default defineConfig({
  testDir: "./tests",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["line"], ["blob"]] : [["list"]],
  use: {
    baseURL,
    viewport: { width: 800, height: 600 },
    screenshot: "only-on-failure",
    trace: production ? "off" : "retain-on-failure",
  },
  webServer: {
    command: production ? "bun run preview --host 127.0.0.1 --port 1422 --strictPort" : "bun run dev --host 127.0.0.1",
    url: baseURL,
    reuseExistingServer: !production && !process.env.CI,
  },
});
