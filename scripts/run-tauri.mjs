/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { build as buildFrontend } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const modes = new Set([undefined, "--check-backend", "--smoke-test", "--test"]);

if (process.argv.length > 3 || !modes.has(mode)) {
  throw new Error("Usage: node scripts/run-tauri.mjs [--check-backend|--smoke-test|--test]");
}

const temporary = await mkdtemp(join(tmpdir(), "freelens-tauri-dev-"));
const cacheKey = createHash("sha256").update(root).digest("hex").slice(0, 16);
const cache = join(homedir(), ".cache", "freelens-tauri");
await mkdir(cache, { recursive: true, mode: 0o700 });
const cacheInfo = await lstat(cache);
if (
  !cacheInfo.isDirectory() ||
  (process.getuid && (cacheInfo.uid !== process.getuid() || (cacheInfo.mode & 0o077) !== 0))
) {
  await rm(temporary, { recursive: true, force: true });
  throw new Error(`Tauri build cache must be an owner-private directory: ${cache}`);
}
const target = join(cache, cacheKey);
const manifest = join(root, "freelens/src-tauri/Cargo.toml");
const backend = join(temporary, "backend.mjs");
const frontend = join(temporary, "frontend");
const environment = {
  ...process.env,
  CARGO_TARGET_DIR: target,
  FREELENS_TAURI_NODE: process.execPath,
  FREELENS_TAURI_BACKEND: backend,
  FREELENS_TAURI_PROFILE: join(temporary, "profile"),
  FREELENS_TAURI_FRONTEND: frontend,
  TAURI_CONFIG: JSON.stringify({ build: { frontendDist: frontend } }),
};

delete environment.NODE_OPTIONS;
delete environment.NODE_PATH;
delete environment.ELECTRON_RUN_AS_NODE;

let child;
let interrupted = false;
let killTimer;
const signalGroup = (running, signal) => {
  try {
    process.kill(-running.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
};
const interrupt = () => {
  interrupted = true;
  if (!child) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => child?.kill());
  } else {
    const running = child;
    signalGroup(running, "SIGTERM");
    killTimer ??= setTimeout(() => signalGroup(running, "SIGKILL"), 3000);
  }
};

process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

const run = async (executable, args) => {
  if (interrupted) return 130;

  const running = spawn(executable, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  child = running;

  try {
    return await new Promise((resolve, reject) => {
      running.once("error", reject);
      running.once("exit", (code, signal) => resolve(code ?? (signal ? 130 : 1)));
    });
  } finally {
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = undefined;
    }
    if (interrupted && process.platform !== "win32") signalGroup(running, "SIGKILL");
    child = undefined;
  }
};

try {
  await buildFrontend({
    configFile: join(root, "freelens/tauri.vite.config.ts"),
    build: { outDir: frontend, emptyOutDir: true },
  });

  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ["freelens/src/main/tauri/backend.ts"],
    outfile: backend,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    metafile: true,
  });

  const unexpected = Object.keys(bundle.metafile.inputs).filter(
    (path) => path.includes("node_modules/") || path.includes("electron"),
  );

  if (unexpected.length > 0) {
    throw new Error(`Tauri bootstrap acquired unsupported runtime dependencies: ${unexpected.join(", ")}`);
  }

  let code;

  if (mode === "--test") {
    code = await run(process.execPath, ["--test", "scripts/tauri-backend.test.mjs", "scripts/tauri-frontend.test.mjs"]);
    if (code === 0) code = await run("cargo", ["test", "--locked", "--manifest-path", manifest]);
  } else {
    code = await run("cargo", ["build", "--locked", "--manifest-path", manifest]);
    if (code === 0) {
      console.log(`Starting Tauri with isolated development files in ${temporary}`);
      code = await run(
        join(target, "debug", `freelens-tauri-dev${process.platform === "win32" ? ".exe" : ""}`),
        mode ? [mode] : [],
      );
    }
  }

  process.exitCode = interrupted ? 130 : code;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  await rm(temporary, { recursive: true, force: true });
}
