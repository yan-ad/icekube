import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "iceon-dev-engine-e2e-"));
export default defineConfig({
  testDir: "./tests",
  testMatch: "dev-engine.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:1420", viewport: { width: 1100, height: 720 }, trace: "retain-on-failure" },
  webServer: {
    command: "bun run dev:web",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: false,
    timeout: 300_000,
    env: { ICEON_DEV_DATA_DIR: join(root, "data"), ICEON_DEV_DISCOVERY_HOME: join(root, "empty-home") },
  },
});
