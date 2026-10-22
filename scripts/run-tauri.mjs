/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
const kubeconfigRoot = join(temporary, "kube");
if (mode) {
  await mkdir(kubeconfigRoot, { recursive: true, mode: 0o700 });
  const execArguments = [
    "-e",
    `require('node:fs').writeFileSync(${JSON.stringify(join(temporary, "exec-must-not-run"))}, 'ran')`,
  ];
  await writeFile(
    join(kubeconfigRoot, "fixture.yaml"),
    `apiVersion: v1\nkind: Config\nclusters:\n  - name: fixture-cluster\n    cluster:\n      server: https://fixture.invalid\nusers:\n  - name: fixture-user\n    user:\n      token: tauri-discovery-sentinel\n      exec:\n        command: ${JSON.stringify(process.execPath)}\n        args: ${JSON.stringify(execArguments)}\ncontexts:\n  - name: fixture-cluster\n    context:\n      cluster: fixture-cluster\n      user: fixture-user\n`,
    { mode: 0o600 },
  );
}
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
  FREELENS_TAURI_KUBECONFIG_ROOTS: JSON.stringify(mode ? [kubeconfigRoot] : [join(homedir(), ".kube")]),
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
    supported: { decorators: false },
    banner: {
      js: `import { createRequire } from "node:module"; const require = createRequire(${JSON.stringify(join(root, "package.json"))});`,
    },
    plugins: [
      {
        name: "explicit-node-catalog-dependencies",
        setup(build) {
          const permitted = new Set(["@ogre-tools/injectable", "mobx", "es-toolkit", "uuid", "joi", "js-yaml"]);
          build.onResolve({ filter: /^[^./]/ }, (args) => {
            if (args.path.startsWith("node:")) return { path: args.path, external: true };
            if (args.path.startsWith("@freelensapp/")) return;
            const name = args.path.startsWith("@")
              ? args.path.split("/").slice(0, 2).join("/")
              : args.path.split("/")[0];
            if (!permitted.has(name)) throw new Error(`Unsupported Node catalog dependency: ${args.path}`);
            // Pin resolution to the importing workspace's installed dependencies,
            // not the temporary bundle directory or NODE_PATH.
            const require = createRequire(args.importer || join(root, "package.json"));
            const path = require.resolve(args.path);
            return name === "@ogre-tools/injectable"
              ? { path, namespace: "pinned-commonjs" }
              : { path, external: true };
          });
          build.onResolve({ filter: /.*/, namespace: "pinned-commonjs" }, (args) => ({
            path: args.path,
            external: true,
          }));
          build.onLoad({ filter: /.*/, namespace: "pinned-commonjs" }, (args) => ({
            contents: `module.exports = require(${JSON.stringify(args.path)});`,
            loader: "js",
          }));
        },
      },
    ],
  });

  const unexpected = Object.keys(bundle.metafile.inputs).filter(
    (path) =>
      (!path.startsWith("pinned-commonjs:") && path.includes("node_modules/")) ||
      /electron|terminal|extensions/i.test(path) ||
      !(
        path.startsWith("pinned-commonjs:") ||
        path.startsWith("freelens/src/main/tauri/") ||
        path.startsWith("packages/core/src/common/catalog/") ||
        path.startsWith("packages/core/src/common/catalog-entities/") ||
        path.startsWith("packages/core/src/main/catalog/") ||
        path.startsWith("packages/core/src/common/front-end-routing/") ||
        path === "packages/core/src/common/kube-config-document.ts" ||
        path === "packages/core/src/common/kubeconfig-file-ignore.ts" ||
        ["preferences-catalog-entity", "preferences-route"].some(
          (leaf) => path === `packages/core/src/features/preferences/common/${leaf}.injectable.ts`,
        ) ||
        path.startsWith("packages/core/src/common/front-end-routing/routes/preferences/") ||
        path === "packages/core/src/main/app-paths/initialize-app-paths.ts" ||
        path === "packages/core/src/common/app-paths/app-path-names.ts" ||
        ["iter", "typed-event-emitter", "type-narrowing", "buildUrl", "collection-functions"].some(
          (leaf) => path === `packages/utility-features/utilities/src/${leaf}.ts`,
        ) ||
        path.startsWith("packages/technical-features/application/application/") ||
        path.startsWith("packages/technical-features/feature-core/") ||
        path.startsWith("packages/utility-features/run-many/")
      ),
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

  if (existsSync(join(temporary, "exec-must-not-run"))) {
    throw new Error("Read-only catalog discovery executed a credential plugin");
  }
  process.exitCode = interrupted ? 130 : code;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  await rm(temporary, { recursive: true, force: true });
}
