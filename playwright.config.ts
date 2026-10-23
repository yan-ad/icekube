import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 800, height: 600 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run dev --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
  },
});
