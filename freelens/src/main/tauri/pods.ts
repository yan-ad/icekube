/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { parsePodsRequest, parsePodsSnapshot } from "../../common/tauri/pods-protocol";

import type { PodsError, PodsRequest, PodsSnapshot } from "../../common/tauri/pods-protocol";

export function podsFailure(request: PodsRequest, error: PodsError): PodsSnapshot {
  return {
    protocolVersion: 1,
    clusterId: request.clusterId,
    namespace: request.namespace,
    pods: [],
    namespaces: [],
    truncated: false,
    warnings: [],
    error,
  };
}

const children = new Set<ReturnType<typeof spawn>>();
let shutdownHooksInstalled = false;
let shuttingDown = false;

const killTree = (child: ReturnType<typeof spawn>) => {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
    else
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on(
        "error",
        () => {},
      );
  } catch {
    /* already gone */
  }
};
/** Also exposed for the backend's explicit stdin EOF/shutdown path. */
export function shutdownPodsWorkers(): void {
  shuttingDown = true;
  for (const child of children) killTree(child);
}

function installShutdownHooks(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  const onSignal = (signal: NodeJS.Signals) => {
    shutdownPodsWorkers();
    process.kill(process.pid, signal);
  };
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("exit", shutdownPodsWorkers);
  process.stdin.once("end", shutdownPodsWorkers);
}

/** Each explicit read gets an owned process tree. Discovery itself never resolves auth. */
export function createPodsReader(options: {
  roots: readonly string[];
  homeDirectory: string;
  workerPath: string;
  nodePath?: string;
}): (request: PodsRequest) => Promise<PodsSnapshot> {
  installShutdownHooks();

  // Configuration authority is backend-private and lasts for this reader's lifetime.
  const fingerprints = new Map<string, string>();
  const pending = new Map<string, Promise<unknown>>();
  const roots = options.roots
    .slice(0, 128)
    .filter((root) => typeof root === "string" && root.length <= 4096 && isAbsolute(root));
  const read = async (request: PodsRequest, deadline: number): Promise<PodsSnapshot> => {
    if (Date.now() >= deadline) return podsFailure(request, "TIMEOUT");
    if (shuttingDown) return podsFailure(request, "UNAVAILABLE");
    if (!isAbsolute(options.workerPath)) return podsFailure(request, "UNAVAILABLE");
    const expectedFingerprint = fingerprints.get(request.clusterId) ?? null;
    const payload = JSON.stringify({ roots, homeDirectory: options.homeDirectory, ...request, expectedFingerprint });
    if (Buffer.byteLength(payload) > 16 * 1024) return podsFailure(request, "CONFIG_UNAVAILABLE");

    return new Promise<PodsSnapshot>((resolve) => {
      const env = { ...process.env };
      // Preserve PATH, HOME and provider-specific plugin environment, but never allow Node injection.
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      delete env.NODE_TLS_REJECT_UNAUTHORIZED;
      const child = spawn(options.nodePath ?? process.execPath, [options.workerPath], {
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
      children.add(child);
      let done = false;
      let bytes = 0;
      const chunks: Buffer[] = [];
      const finish = (result: PodsSnapshot) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        killTree(child); // Also on success: exec plugins may have left descendants holding pipes.
        children.delete(child);
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        // Resolve only after the direct child has been reaped. Descendant pipes
        // are destroyed above, so an inherited descriptor cannot delay close.
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) resolve(result);
        else child.once("exit", () => resolve(result));
      };
      const timer = setTimeout(() => finish(podsFailure(request, "TIMEOUT")), Math.max(0, deadline - Date.now()));
      child.on("error", () => finish(podsFailure(request, "UNAVAILABLE")));
      child.stdin.on("error", () => {});
      // Discard immediately; neither inherit nor retain credential-bearing plugin stderr.
      child.stderr.on("data", () => {});
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) finish(podsFailure(request, "RESPONSE_TOO_LARGE"));
        else chunks.push(chunk);
      });
      const parseResult = (): PodsSnapshot => {
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          !result ||
          typeof result !== "object" ||
          Array.isArray(result) ||
          Object.keys(result).sort().join(",") !== "authorizationFingerprint,snapshot" ||
          !(
            result.authorizationFingerprint === null ||
            (typeof result.authorizationFingerprint === "string" &&
              /^[a-f0-9]{64}$/.test(result.authorizationFingerprint))
          )
        )
          throw new Error();
        const snapshot = parsePodsSnapshot(result.snapshot, request);
        const fingerprint = result.authorizationFingerprint as string | null;
        if (expectedFingerprint !== null && fingerprint !== expectedFingerprint) throw new Error();
        if (fingerprint !== null) fingerprints.set(request.clusterId, fingerprint);
        return snapshot;
      };
      // The worker emits one newline-delimited result and then exits. Reading the result
      // without waiting for close lets us reap plugins which inherited the stdout pipe.
      child.stdout.on("data", () => {
        if (done || !chunks.some((chunk) => chunk.includes(10))) return;
        try {
          finish(parseResult());
        } catch {
          finish(podsFailure(request, "INVALID_RESPONSE"));
        }
      });
      child.on("exit", (code) => {
        killTree(child);
        if (code !== 0) finish(podsFailure(request, "UNAVAILABLE"));
      });
      child.on("close", () => {
        if (done) return;
        try {
          finish(parseResult());
        } catch {
          finish(podsFailure(request, "INVALID_RESPONSE"));
        }
      });
      child.stdin.end(payload);
    });
  };
  return (input) => {
    const request = parsePodsRequest(input);
    const deadline = Date.now() + 15_000;
    // Serialize each cluster so concurrent first reads cannot approve different configurations.
    const result = (pending.get(request.clusterId) ?? Promise.resolve()).then(() => read(request, deadline));
    pending.set(request.clusterId, result);
    void result
      .finally(() => {
        if (pending.get(request.clusterId) === result) pending.delete(request.clusterId);
      })
      .catch(() => {});
    return result;
  };
}
