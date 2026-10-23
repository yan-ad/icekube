/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { discoverKubeconfigContexts } from "./kubeconfig-discovery";
import { createPodsReader } from "./pods";
import { readPodsSelection, readWorkerRequest } from "./pods-worker";
import type { RequestListener } from "node:http";

import type { PodsSelection } from "./pods-worker";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const token = "synthetic-token-never-in-dto";
const pod = (uid: string, namespace = "default") => ({
  apiVersion: "v1",
  kind: "Pod",
  metadata: { uid, name: uid, namespace, creationTimestamp: "2025-01-01T00:00:00Z" },
  spec: {
    nodeName: "node-a",
    containers: [{ name: "app", image: "private", env: [{ name: "SECRET", value: token }] }],
  },
  status: {
    phase: "Running",
    containerStatuses: [{ name: "app", ready: true, restartCount: 2, state: { running: {} } }],
  },
});
async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  const directory = await mkdtemp(path.join(tmpdir(), "freelens-pods-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const canonicalPath = path.join(await realpath(directory), "config");
  await writeFile(
    canonicalPath,
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      "current-context": "test",
      clusters: [
        { name: "cluster", cluster: { server: `http://127.0.0.1:${address.port}`, "insecure-skip-tls-verify": true } },
      ],
      users: [
        { name: "selected", user: { token } },
        { name: "unused", user: { "token-file": "/nonexistent/never-read" } },
      ],
      contexts: [{ name: "test", context: { cluster: "cluster", user: "selected" } }],
    }),
  );
  const selection: PodsSelection = {
    canonicalPath,
    contextName: "test",
    namespace: null,
    clusterId: createHash("md5").update(`${canonicalPath}:test`).digest("hex"),
  };
  return { directory, selection };
}

async function bundleWorker(directory: string) {
  const workerPath = path.join(directory, "pods-worker.mjs");
  // Exercise the runner's actual ESM/pinned-dependency runtime, not Vitest's
  // imported source module. Keep these options aligned with buildPodsWorker.
  await build({
    entryPoints: [path.resolve("freelens/src/main/tauri/pods-worker.ts")],
    outfile: workerPath,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    supported: { decorators: false },
    plugins: [
      {
        name: "pinned-pods-worker-dependencies",
        setup(builder) {
          const permitted = new Set(["@kubernetes/client-node", "undici", "joi", "js-yaml", "auto-bind", "es-toolkit"]);
          builder.onResolve({ filter: /^[^./]/ }, (args) => {
            if (args.path.startsWith("node:")) return { path: args.path, external: true };
            if (args.path.startsWith("@freelensapp/")) return;
            const name = args.path.startsWith("@")
              ? args.path.split("/").slice(0, 2).join("/")
              : args.path.split("/")[0];
            if (!permitted.has(name)) throw new Error(`Unsupported Pods worker dependency: ${args.path}`);
            return { path: createRequire(args.importer).resolve(args.path), external: true };
          });
        },
      },
    ],
  });
  return workerPath;
}

async function bundleReader() {
  const result = await build({
    entryPoints: [path.resolve("freelens/src/main/tauri/pods.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [
      {
        name: "pinned-test-dependencies",
        setup(builder) {
          builder.onResolve({ filter: /^[^./]/ }, (args) =>
            args.path.startsWith("node:")
              ? { path: args.path, external: true }
              : { path: createRequire(args.importer).resolve(args.path), external: true },
          );
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

async function eventually(check: () => Promise<boolean>, milliseconds = 3000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Synthetic process did not reach expected state");
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("owned read-only Pods worker", () => {
  it.each(["server", "auth", "exec"])(
    "pins selected %s configuration before failed auth and blocks changes",
    async (change) => {
      let requests = 0;
      const { selection, directory } = await fixture((_req, res) => {
        requests++;
        res.statusCode = 403;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ message: token }));
      });
      const workerPath = process.env.FREELENS_TAURI_PODS_WORKER ?? (await bundleWorker(directory));
      const reader = createPodsReader({ roots: [selection.canonicalPath], homeDirectory: directory, workerPath });
      const request = { clusterId: selection.clusterId, namespace: null };
      expect((await reader(request)).error).toBe("FORBIDDEN");
      expect((await reader(request)).error).toBe("FORBIDDEN");
      expect(requests).toBe(2);
      const config = JSON.parse(await readFile(selection.canonicalPath, "utf8"));
      const original = JSON.stringify(config);
      const marker = path.join(directory, "changed-exec-ran");
      if (change === "server") config.clusters[0].cluster.server += "/changed";
      if (change === "auth") config.users[0].user.token = "changed-synthetic-token";
      if (change === "exec")
        config.users[0].user = {
          exec: {
            apiVersion: "client.authentication.k8s.io/v1beta1",
            command: process.execPath,
            args: ["-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`],
          },
        };
      await writeFile(selection.canonicalPath, JSON.stringify(config));
      expect((await reader(request)).error).toBe("CONFIG_UNAVAILABLE");
      expect((await reader(request)).error).toBe("CONFIG_UNAVAILABLE");
      expect(requests).toBe(2);
      await expect(readFile(marker)).rejects.toThrow();
      await writeFile(selection.canonicalPath, original);
      expect((await reader(request)).error).toBe("FORBIDDEN");
    },
  );

  it("fingerprints canonical selected data only and checks the selected cluster identity", async () => {
    const { selection, directory } = await fixture((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ items: [] }));
    });
    const request = {
      roots: [selection.canonicalPath],
      homeDirectory: directory,
      clusterId: selection.clusterId,
      namespace: null,
      expectedFingerprint: null,
    };
    const first = await readWorkerRequest(request);
    expect(first.authorizationFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const config = JSON.parse(await readFile(selection.canonicalPath, "utf8"));
    config.users[1].user = { token: "unselected-change" };
    config.clusters[0].cluster = Object.fromEntries(Object.entries(config.clusters[0].cluster).reverse());
    await writeFile(selection.canonicalPath, JSON.stringify(config));
    const next = await readWorkerRequest({ ...request, expectedFingerprint: first.authorizationFingerprint });
    expect(next.snapshot.error).toBeNull();
    expect(next.authorizationFingerprint).toBe(first.authorizationFingerprint);
    expect((await readPodsSelection({ ...selection, clusterId: "0".repeat(32) })).error).toBe("CONFIG_UNAVAILABLE");
    expect(JSON.stringify(next.snapshot)).not.toContain(first.authorizationFingerprint!);
  });

  it.each(["legacy", "extra", "fingerprint", "snapshot"])(
    "rejects malformed internal worker envelope: %s",
    async (malformed) => {
      const { selection, directory } = await fixture(() => {});
      const workerPath = path.join(directory, "malformed-worker.cjs");
      const snapshot = {
        protocolVersion: 1,
        clusterId: selection.clusterId,
        namespace: null,
        pods: [],
        namespaces: [],
        truncated: false,
        warnings: [],
        error: null,
      };
      const result =
        malformed === "legacy"
          ? snapshot
          : {
              snapshot: malformed === "snapshot" ? {} : snapshot,
              authorizationFingerprint: malformed === "fingerprint" ? "secret-not-a-digest" : null,
              ...(malformed === "extra" ? { extra: true } : {}),
            };
      await writeFile(
        workerPath,
        `process.stdin.resume();process.stdin.on('end',()=>console.log(${JSON.stringify(JSON.stringify(result))}));`,
      );
      expect(
        (
          await createPodsReader({ roots: [], homeDirectory: directory, workerPath })({
            clusterId: selection.clusterId,
            namespace: null,
          })
        ).error,
      ).toBe("INVALID_RESPONSE");
    },
  );

  it("does not auto-bypass TLS policy for HTTP, but honors explicit opt-in", async () => {
    const { selection } = await fixture((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ items: [] }));
    });
    const config = JSON.parse(await readFile(selection.canonicalPath, "utf8"));
    delete config.clusters[0].cluster["insecure-skip-tls-verify"];
    await writeFile(selection.canonicalPath, JSON.stringify(config));
    const denied = await readPodsSelection(selection);
    expect(denied.error).toBe("UNAVAILABLE");
    expect(JSON.stringify(denied)).not.toContain("127.0.0.1");
    config.clusters[0].cluster["insecure-skip-tls-verify"] = true;
    await writeFile(selection.canonicalPath, JSON.stringify(config));
    expect((await readPodsSelection(selection)).error).toBeNull();
  });

  it("does not override HTTPS TLS configuration", async () => {
    const source = await readFile(path.resolve("freelens/src/main/tauri/pods-worker.ts"), "utf8");
    expect(source).not.toMatch(/skipTLSVerify\s*=|rejectUnauthorized\s*:/);
  });

  it("uses selected credentials only, pages with limit 200, projects no raw spec", async () => {
    const requests: string[] = [];
    const { selection } = await fixture((req, res) => {
      requests.push(req.url!);
      expect(req.method).toBe("GET");
      expect(req.headers.authorization).toBe(`Bearer ${token}`);
      const next = new URL(req.url!, "http://localhost").searchParams.get("continue");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          apiVersion: "v1",
          kind: "PodList",
          metadata: { continue: next ? "" : "page2" },
          items: [pod(next ? "two" : "one")],
        }),
      );
    });
    const result = await readPodsSelection(selection);
    expect(result.error).toBeNull();
    expect(result.pods.map((p) => p.uid)).toEqual(["one", "two"]);
    expect(result.pods[0]).toMatchObject({
      readyContainers: 1,
      totalContainers: 1,
      restartCount: 2,
      status: "Running",
      cpu: null,
      memory: null,
    });
    expect(requests).toHaveLength(2);
    expect(requests.every((url) => new URL(url, "http://localhost").searchParams.get("limit") === "200")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toMatch(/image|SECRET|authorization|canonicalPath/);
  });
  it("uses the namespaced endpoint", async () => {
    const paths: string[] = [];
    const { selection } = await fixture((req, res) => {
      paths.push(req.url!);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ items: [pod("one", "team")] }));
    });
    const result = await readPodsSelection({ ...selection, namespace: "team" });
    expect(result.error).toBeNull();
    expect(paths[0]).toMatch(/^\/api\/v1\/namespaces\/team\/pods\?/);
    expect(result.namespaces).toEqual(["team"]);
  });
  it("sanitizes forbidden and malformed responses", async () => {
    let forbidden = true;
    const { selection } = await fixture((_req, res) => {
      res.statusCode = forbidden ? 403 : 200;
      res.setHeader("content-type", "application/json");
      res.end(forbidden ? JSON.stringify({ message: token }) : "{malformed");
    });
    expect((await readPodsSelection(selection)).error).toBe("FORBIDDEN");
    forbidden = false;
    const result = await readPodsSelection(selection);
    expect(result.error).toBe("INVALID_RESPONSE");
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("preserves forbidden errors through the real built worker on HTTP", async () => {
    const { selection, directory } = await fixture((_req, res) => {
      res.statusCode = 403;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: token }));
    });
    const workerPath = process.env.FREELENS_TAURI_PODS_WORKER ?? (await bundleWorker(directory));
    const result = await createPodsReader({ roots: [selection.canonicalPath], homeDirectory: directory, workerPath })({
      clusterId: selection.clusterId,
      namespace: null,
    });
    expect(result.error).toBe("FORBIDDEN");
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("rejects HTTP without explicit opt-in through the real built worker", async () => {
    const { selection, directory } = await fixture((_req, res) => {
      res.statusCode = 403;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: token }));
    });
    const config = JSON.parse(await readFile(selection.canonicalPath, "utf8"));
    delete config.clusters[0].cluster["insecure-skip-tls-verify"];
    await writeFile(selection.canonicalPath, JSON.stringify(config));
    const workerPath = process.env.FREELENS_TAURI_PODS_WORKER ?? (await bundleWorker(directory));
    const result = await createPodsReader({ roots: [selection.canonicalPath], homeDirectory: directory, workerPath })({
      clusterId: selection.clusterId,
      namespace: null,
    });
    expect(result.error).toBe("UNAVAILABLE");
    expect(JSON.stringify(result)).not.toMatch(/127\.0\.0\.1|synthetic-token-never-in-dto|canonicalPath/);
  });
  it("does not follow credential-bearing redirects", async () => {
    let targetRequests = 0;
    const target = await fixture((_req, res) => {
      targetRequests++;
      res.end(JSON.stringify({ items: [] }));
    });
    const targetConfig = JSON.parse(await readFile(target.selection.canonicalPath, "utf8"));
    const { selection } = await fixture((_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", targetConfig.clusters[0].cluster.server);
      res.end();
    });
    expect((await readPodsSelection(selection)).error).not.toBeNull();
    expect(targetRequests).toBe(0);
  });
  it("aborts stalled HTTP reads", async () => {
    const { selection } = await fixture(() => {});
    expect((await readPodsSelection(selection, 40)).error).toBe("TIMEOUT");
  });
  it("bounds raw bytes before JSON parsing", async () => {
    const { selection } = await fixture((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(" ".repeat(8 * 1024 * 1024 + 1));
    });
    expect((await readPodsSelection(selection)).error).toBe("RESPONSE_TOO_LARGE");
  });
  it("never runs exec during discovery or for an unknown cluster", async () => {
    const { selection, directory } = await fixture(() => {
      throw new Error("must not connect");
    });
    const marker = path.join(directory, "auth-ran");
    const config = JSON.parse(await readFile(selection.canonicalPath, "utf8"));
    config.users[0].user = {
      exec: {
        apiVersion: "client.authentication.k8s.io/v1beta1",
        command: process.execPath,
        args: ["-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`],
      },
    };
    await writeFile(selection.canonicalPath, JSON.stringify(config));
    const options = {
      roots: [selection.canonicalPath],
      homeDirectory: directory,
      workerPath: process.env.FREELENS_TAURI_PODS_WORKER ?? (await bundleWorker(directory)),
    };
    expect((await discoverKubeconfigContexts(options)).entities).toHaveLength(1);
    expect((await createPodsReader(options)({ clusterId: "0".repeat(32), namespace: null })).error).toBe(
      "CLUSTER_NOT_FOUND",
    );
    await expect(readFile(marker)).rejects.toThrow();
  });
  it("supervises worker output and strips Node injection environment", async () => {
    const { selection, directory } = await fixture(() => {});
    const workerPath = path.join(directory, "fake-worker.cjs");
    await writeFile(
      workerPath,
      `let raw='';process.stdin.on('data', x=>raw+=x);process.stdin.on('end',()=>{const r=JSON.parse(raw);if(process.env.NODE_OPTIONS) process.exit(4);console.log(JSON.stringify({snapshot:{protocolVersion:1,clusterId:r.clusterId,namespace:r.namespace,pods:[],namespaces:[],truncated:false,warnings:[],error:null},authorizationFingerprint:null}));setInterval(()=>{},1000);});`,
    );
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--invalid-node-flag";
    try {
      const result = await createPodsReader({ roots: [selection.canonicalPath], homeDirectory: directory, workerPath })(
        { clusterId: selection.clusterId, namespace: null },
      );
      expect(result.error).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
  });

  it.each(["SIGTERM", "SIGINT", "exit", "eof"] as const)(
    "kills worker and auth descendants on backend %s",
    async (shutdown) => {
      if (process.platform === "win32") return; // POSIX process-group assertion; Windows uses taskkill /T.
      const { selection, directory } = await fixture(() => {});
      const marker = path.join(directory, "pids.json");
      const workerPath = path.join(directory, "synthetic-worker.cjs");
      await writeFile(
        workerPath,
        `const {spawn}=require('node:child_process');
      const plugin=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
      require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,plugin.pid]));
      setInterval(()=>{},1000);`,
      );
      const backendPath = path.join(directory, "synthetic-backend.cjs");
      await writeFile(
        backendPath,
        `${await bundleReader()}
      process.stdin.resume();
      ${shutdown === "exit" ? "process.stdin.once('data',()=>process.exit(0));" : ""}
      void createPodsReader(${JSON.stringify({ roots: [selection.canonicalPath], homeDirectory: directory, workerPath })})(${JSON.stringify({ clusterId: selection.clusterId, namespace: null })});`,
      );
      const backend = spawn(process.execPath, [backendPath], { stdio: ["pipe", "ignore", "pipe"] });
      let diagnostics = "";
      backend.stderr.on("data", (data) => {
        diagnostics += String(data).slice(0, 1024);
      });
      cleanup.push(async () => {
        backend.kill("SIGKILL");
      });
      await eventually(async () => {
        if (backend.exitCode !== null) throw new Error(`Synthetic backend exited: ${diagnostics}`);
        try {
          await readFile(marker);
          return true;
        } catch {
          return false;
        }
      });
      const pids: number[] = JSON.parse(await readFile(marker, "utf8"));
      cleanup.push(async () => {
        for (const pid of pids) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      });
      expect(pids.every(alive)).toBe(true);
      if (shutdown === "eof") backend.stdin.end();
      else if (shutdown === "exit") backend.stdin.write("exit");
      else backend.kill(shutdown);
      await eventually(async () => pids.every((pid) => !alive(pid)));
    },
  );

  it("can use the runner's real built worker against only a synthetic local API", async () => {
    const { selection, directory } = await fixture((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ items: [pod("real-worker")] }));
    });
    const workerPath = process.env.FREELENS_TAURI_PODS_WORKER ?? (await bundleWorker(directory));
    const result = await createPodsReader({ roots: [selection.canonicalPath], homeDirectory: directory, workerPath })({
      clusterId: selection.clusterId,
      namespace: null,
    });
    expect(result.error).toBeNull();
    expect(result.pods.map((p) => p.uid)).toEqual(["real-worker"]);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("bounds the whole worker including a stalled discovery phase and reaps descendants", async () => {
    if (process.platform === "win32") return;
    const { selection, directory } = await fixture(() => {});
    const marker = path.join(directory, "timed-out-pids.json");
    const workerPath = path.join(directory, "hung-worker.cjs");
    await writeFile(
      workerPath,
      `// Stalled before input/discovery resolution; supervisor still owns this phase.
      const plugin=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
      require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,plugin.pid]));setInterval(()=>{},1000);`,
    );
    const result = await createPodsReader({ roots: [selection.canonicalPath], homeDirectory: directory, workerPath })({
      clusterId: selection.clusterId,
      namespace: null,
    });
    const pids: number[] = JSON.parse(await readFile(marker, "utf8"));
    cleanup.push(async () => {
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    });
    expect(result.error).toBe("TIMEOUT");
    // The promise must wait for reaping the direct worker, not merely send kill.
    expect(alive(pids[0])).toBe(false);
    await eventually(async () => !alive(pids[1]));
  }, 20_000);
});
