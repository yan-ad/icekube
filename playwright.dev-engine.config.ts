import { defineConfig } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "iceon-dev-engine-e2e-"));
const home = join(root, "home");
mkdirSync(join(home, ".kube"), { recursive: true });
writeFileSync(join(home, ".kube", "config"), "apiVersion: v1\nkind: Config\nclusters:\n- name: discovered\n  cluster:\n    server: https://127.0.0.1:9\ncontexts:\n- name: Discovered fixture\n  context:\n    cluster: discovered\ncurrent-context: Discovered fixture\n");
export default defineConfig({
  testDir: "./tests",
  testMatch: "dev-engine.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:1430", viewport: { width: 1100, height: 720 }, trace: "retain-on-failure" },
  webServer: {
    command: "bun run dev:web",
    url: "http://127.0.0.1:1430",
    reuseExistingServer: false,
    timeout: 300_000,
    env: { ICEON_DEV_PORT: "1430", ICEON_DEV_DATA_DIR: join(root, "data"), ICEON_DEV_DISCOVERY_HOME: home },
  },
});
