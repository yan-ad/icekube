import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";

test("default Vite startup rejects an occupied IPv4 port instead of starting on IPv6", async () => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("Expected loopback TCP listener");
    const result = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(address.port), "--strictPort"], {
      env: { ...process.env, ICEON_DEV_ENGINE: "0", ICEON_DEV_DISCOVERY: "0", TAURI_DEV_HOST: "" },
      encoding: "utf8", timeout: 20_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Port ${address.port} is already in use`);
  } finally { await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve())); }
});

test("tauri:inspect enables the browser engine and default-file discovery", async () => {
  const { scripts } = JSON.parse(await readFile("package.json", "utf8"));
  expect(scripts["tauri:inspect"]).toContain("ICEON_DEV_ENGINE=1");
  expect(scripts["tauri:inspect"]).toContain("ICEON_DEV_DISCOVERY=1");
  expect(scripts["tauri:inspect"]).toContain("tauri dev");
  const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
  expect(config.build.devUrl).toBe("http://127.0.0.1:1420");
});

test("browser adapter releases its disconnected workspace lease on reload", async ({ page }) => {
  await page.goto("/");
  const catalog = await call(page, "catalog_list");
  const clusterId = catalog.body.value.clusters.find((cluster: { contextName: string }) => cluster.contextName === "Discovered fixture").id;
  const opened = await page.evaluate(async clusterId => {
    const path = "/src/app/engine.ts";
    const engine = await import(path);
    return engine.invoke("cluster_session_open", { request: { clusterId } });
  }, clusterId);
  expect(opened.status).toBe("disconnected");
  expect((await call(page, "cluster_session_open", { request: { clusterId } })).body).toEqual({ ok: false, error: "busy" });
  await page.reload();
  await expect.poll(async () => (await call(page, "cluster_session_open", { request: { clusterId } })).body.ok).toBe(true);
  const replacement = await call(page, "cluster_session_open", { request: { clusterId } });
  expect((await call(page, "cluster_disconnect", { request: { clusterId, sessionId: replacement.body.value.sessionId } })).body.ok).toBe(true);
});

async function call(page: Page, command: string, args: object = {}, client?: string) {
  return page.evaluate(async ({ command, args, client }) => {
    const result = await fetch("/__iceon_engine/invoke", {
      method: "POST", headers: { "Content-Type": "application/json", "x-iceon-dev": "1", "x-iceon-client": client ?? "00000000-0000-4000-8000-000000000001" },
      body: JSON.stringify({ command, args }),
    });
    return { status: result.status, body: await result.json(), cache: result.headers.get("cache-control") };
  }, { command, args, client });
}

test("browser catalog persists through the real Rust engine without Tauri globals", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("row").filter({ hasText: "Discovered fixture" })).toBeVisible();
  const discovered = await call(page, "catalog_list");
  expect(discovered.body.value.clusters).toEqual([expect.objectContaining({
    contextName: "Discovered fixture", status: "disconnected", labels: expect.arrayContaining(["file=~/.kube/config"]),
  })]);
  expect(await page.evaluate(() => "__TAURI_INTERNALS__" in window)).toBe(false);
  await page.getByRole("button", { name: "Add web link", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name Required", exact: true }).fill("Bridge fixture");
  await dialog.getByRole("textbox", { name: "URL Required", exact: true }).fill("https://example.test/docs");
  await dialog.getByRole("button", { name: "Save web link", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Pin Bridge fixture", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Unpin Bridge fixture", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove Bridge fixture", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove from catalog", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Discovered fixture" })).toBeVisible();
  const preferences = await call(page, "preferences_get");
  expect(preferences.body.ok).toBe(true);
  expect(preferences.cache).toBe("no-store");
  expect(errors).toEqual([]);
});

test("proxy rejects untrusted requests, native commands, and malformed domain args", async ({ page, request }) => {
  await page.goto("/");
  const forbidden = await request.post("/__iceon_engine/invoke", {
    headers: { Origin: "https://untrusted.example", "x-iceon-dev": "1", "x-iceon-client": "00000000-0000-4000-8000-000000000001" },
    data: { command: "catalog_list", args: {} },
  });
  expect(forbidden.status()).toBe(403);
  expect(forbidden.headers()["access-control-allow-origin"]).toBeUndefined();
  expect((await call(page, "catalog_list", { arbitrary: "SECRET_FIXTURE" })).body).toEqual({ ok: false, error: "invalidInput" });
  expect((await call(page, "catalog_choose_kubeconfig")).body).toEqual({ ok: false, error: "unknownCommand" });
  expect((await call(page, "plugin:shell|execute")).body).toEqual({ ok: false, error: "unknownCommand" });
  const missingHeader = await page.evaluate(async () => (await fetch("/__iceon_engine/invoke", { method: "POST", body: "{}" })).status);
  expect(missingHeader).toBe(403);
  expect((await request.get("/.iceon-dev/catalog.sqlite3")).status()).not.toBe(200);
});

test("synthetic imported session is owned by one browser client and can be released", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "iceon-dev-config-"));
  const path = join(root, "config");
  await writeFile(path, "apiVersion: v1\nkind: Config\nclusters:\n- name: fixture\n  cluster:\n    server: https://127.0.0.1:9\ncontexts:\n- name: Fixture\n  context:\n    cluster: fixture\ncurrent-context: Fixture\n");
  try {
    await page.goto("/");
    const imported = await call(page, "catalog_import_kubeconfig", { request: { path } });
    expect(imported.body.ok).toBe(true);
    const clusterId = imported.body.value.clusters.find((cluster: { contextName: string }) => cluster.contextName === "Fixture").id;
    const opened = await call(page, "cluster_session_open", { request: { clusterId } });
    expect(opened.body.value.status).toBe("disconnected");
    const scope = { clusterId, sessionId: opened.body.value.sessionId };
    expect((await call(page, "cluster_connection_status", { request: scope })).body.value.status).toBe("disconnected");
    expect((await call(page, "cluster_session_open", { request: { clusterId } }, "00000000-0000-4000-8000-000000000002")).body).toEqual({ ok: false, error: "busy" });
    expect((await call(page, "cluster_disconnect", { request: scope })).body.ok).toBe(true);
    expect((await call(page, "catalog_remove", { request: { id: clusterId } })).body.ok).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
