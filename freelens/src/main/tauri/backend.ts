/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { isAbsolute, join } from "node:path";
import {
  type AppPathHost,
  initializeAppPaths,
} from "../../../../packages/core/src/main/app-paths/initialize-app-paths";
import { createHostApplicationStarter } from "../../../../packages/technical-features/application/application/src/start-application/create-host-application-starter";
import {
  type PodsRequest,
  type PodsSnapshot,
  parsePodsRequest,
  parsePodsSnapshot,
} from "../../common/tauri/pods-protocol";
import { createBuiltInCatalog } from "./catalog";
import { createPodsReader } from "./pods";

import type { CatalogSnapshot, RuntimeStatus } from "../../common/tauri/protocol";

type BackendResponse =
  | { id: number; result: RuntimeStatus | CatalogSnapshot | PodsSnapshot }
  | { id: number | null; error: string };

const maximumRequestBytes = 16 * 1024;
let listPods: ((request: PodsRequest) => Promise<PodsSnapshot>) | undefined;
let initializationStarted = false;
let status: RuntimeStatus | undefined;
let catalogSnapshot: (() => Promise<CatalogSnapshot>) | undefined;

// This host only computes paths in memory. It never asks the OS for a profile,
// opens credentials, or creates the userData/sessionData directories.
const initialize = async (appData: string): Promise<RuntimeStatus> => {
  if (initializationStarted) {
    throw new Error("Backend has already been initialized");
  }

  initializationStarted = true;

  const paths = new Map<string, string>([["appData", appData]]);
  const host: AppPathHost = {
    getPath: (name) => paths.get(name) ?? "",
    setPath: (name, value) => {
      paths.set(name, value);
    },
  };
  const phases: string[] = [];
  let appPaths: ReturnType<typeof initializeAppPaths> | undefined;
  const start = createHostApplicationStarter({
    beforeAnything: () => {
      appPaths = initializeAppPaths({
        host,
        appName: "Freelens",
        directoryForIntegrationTesting: undefined,
        joinPaths: join,
      });
      phases.push("before-anything");
    },
    beforeHostIsReady: () => {
      phases.push("before-host-ready");
    },
    whenHostIsReady: async () => {
      phases.push("host-ready");
    },
    startApplication: async () => {
      // Only the explicitly composed, in-memory built-ins are started.
      let roots: unknown = [];
      try {
        if (process.env.FREELENS_TAURI_KUBECONFIG_ROOTS !== undefined) {
          roots = JSON.parse(process.env.FREELENS_TAURI_KUBECONFIG_ROOTS);
        }
      } catch {
        throw new Error("Invalid catalog discovery roots configuration");
      }
      if (!Array.isArray(roots) || roots.some((root) => typeof root !== "string")) {
        throw new Error("Invalid catalog discovery roots configuration");
      }
      catalogSnapshot = createBuiltInCatalog({ roots, homeDirectory: process.env.HOME });
      const workerPath = process.env.FREELENS_TAURI_PODS_WORKER;
      if (workerPath !== undefined && (!isAbsolute(workerPath) || workerPath.includes("\0"))) {
        throw new Error("Invalid Pods worker configuration");
      }
      listPods = workerPath
        ? createPodsReader({ roots, homeDirectory: process.env.HOME ?? "", workerPath, nodePath: process.execPath })
        : undefined;
      phases.push("application-started");
    },
  });

  await start();

  if (!appPaths) {
    throw new Error("Application paths were not initialized");
  }

  status = {
    protocolVersion: 1,
    runtime: "node",
    nodeVersion: process.versions.node,
    processId: process.pid,
    userData: appPaths.userData,
    sessionData: appPaths.sessionData,
    phases,
  };

  return status;
};

const isRequestId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const handleRequest = async (line: string): Promise<BackendResponse> => {
  let id: number | null = null;

  try {
    const request: unknown = JSON.parse(line);

    if (typeof request !== "object" || request === null || Array.isArray(request)) {
      throw new Error("Request must be an object");
    }

    const fields = request as Record<string, unknown>;

    if (!Object.hasOwn(fields, "id") || !isRequestId(fields.id)) {
      throw new Error("Request id must be a positive safe integer");
    }

    id = fields.id;

    if (!Object.hasOwn(fields, "method") || typeof fields.method !== "string") {
      throw new Error("Request method must be a string");
    }

    const allowedKeys =
      fields.method === "initialize"
        ? ["id", "method", "appData"]
        : fields.method === "pods.list"
          ? ["id", "method", "clusterId", "namespace"]
          : ["id", "method"];

    if (Object.keys(fields).some((key) => !allowedKeys.includes(key))) {
      throw new Error("Request contains unsupported keys");
    }

    switch (fields.method) {
      case "initialize": {
        if (
          !Object.hasOwn(fields, "appData") ||
          typeof fields.appData !== "string" ||
          fields.appData.includes("\0") ||
          !isAbsolute(fields.appData)
        ) {
          throw new Error("appData must be an absolute path string");
        }

        return { id, result: await initialize(fields.appData) };
      }
      case "pods.list": {
        const dto = parsePodsRequest({ clusterId: fields.clusterId, namespace: fields.namespace });
        if (!status) throw new Error("Backend has not been initialized");
        const unavailable = (error: "UNAVAILABLE" | "INVALID_RESPONSE" | "RESPONSE_TOO_LARGE"): PodsSnapshot => ({
          protocolVersion: 1,
          ...dto,
          pods: [],
          namespaces: [],
          truncated: false,
          warnings: [],
          error,
        });
        if (!listPods) return { id, result: unavailable("UNAVAILABLE") };
        try {
          const result = parsePodsSnapshot(await listPods(dto), dto);
          return Buffer.byteLength(JSON.stringify({ id, result })) + 1 > 1024 * 1024
            ? { id, result: unavailable("RESPONSE_TOO_LARGE") }
            : { id, result };
        } catch {
          return { id, result: unavailable("INVALID_RESPONSE") };
        }
      }
      case "status": {
        if (!status) {
          throw new Error("Backend has not been initialized");
        }

        return { id, result: status };
      }
      case "catalog.snapshot": {
        if (!status || !catalogSnapshot) {
          throw new Error("Backend has not been initialized");
        }

        try {
          return { id, result: await catalogSnapshot() };
        } catch {
          return { id, error: "Catalog snapshot unavailable" };
        }
      }
      default:
        throw new Error("Unknown method");
    }
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : "Request failed" };
  }
};

// Read bytes rather than readline's unbounded line buffer. Once a request is
// oversized, discard it through its newline and emit exactly one error. null
// represents that discarded line; a final unterminated line is handled at EOF.
async function* readRequestLines(): AsyncGenerator<string | null> {
  let parts: Buffer[] = [];
  let length = 0;
  let oversized = false;

  for await (const chunk of process.stdin) {
    const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;

    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      const segment = bytes.subarray(offset, end);

      if (!oversized) {
        length += segment.length;

        if (length > maximumRequestBytes) {
          oversized = true;
          parts = [];
        } else if (segment.length > 0) {
          // Copy to avoid retaining an entire input chunk for a short tail.
          parts.push(Buffer.from(segment));
        }
      }

      if (newline < 0) {
        break;
      }

      yield oversized ? null : Buffer.concat(parts, length).toString("utf8");
      parts = [];
      length = 0;
      oversized = false;
      offset = newline + 1;
    }
  }

  if (oversized || length > 0) {
    yield oversized ? null : Buffer.concat(parts, length).toString("utf8");
  }
}

const writeResponse = (response: BackendResponse): Promise<void> =>
  new Promise((resolve, reject) => {
    let serialized = JSON.stringify(response);
    if (Buffer.byteLength(serialized) + 1 > 1024 * 1024) {
      serialized = JSON.stringify({ id: response.id, error: "Response exceeds the 1 MiB limit" });
    }
    // Awaiting the write callback bounds pending output even under backpressure.
    process.stdout.write(`${serialized}\n`, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

let failed = false;

const fail = (error: unknown): void => {
  if (failed) {
    return;
  }

  failed = true;
  process.exitCode = 1;
  console.error("Freelens Node backend failed:", error instanceof Error ? error.message : "Unknown error");
  process.stdin.destroy();
};

process.stdout.on("error", fail);

const run = async (): Promise<void> => {
  for await (const line of readRequestLines()) {
    if (failed) {
      break;
    }

    const response: BackendResponse =
      line === null ? { id: null, error: "Request exceeds the 16 KiB limit" } : await handleRequest(line);

    await writeResponse(response);
  }
};

void run().catch(fail);
