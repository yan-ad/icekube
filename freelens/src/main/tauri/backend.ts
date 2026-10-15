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

interface BackendStatus {
  protocolVersion: 1;
  runtime: "node";
  nodeVersion: string;
  processId: number;
  userData: string;
  sessionData: string;
  phases: string[];
}

type BackendResponse = { id: number; result: BackendStatus } | { id: number | null; error: string };

const maximumRequestBytes = 16 * 1024;
let initializationStarted = false;
let status: BackendStatus | undefined;

// This host only computes paths in memory. It never asks the OS for a profile,
// opens credentials, or creates the userData/sessionData directories.
const initialize = async (appData: string): Promise<BackendStatus> => {
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
      // Metadata bootstrap only: application services are not started here yet.
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

    const allowedKeys = fields.method === "initialize" ? ["id", "method", "appData"] : ["id", "method"];

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
      case "status": {
        if (!status) {
          throw new Error("Backend has not been initialized");
        }

        return { id, result: status };
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
    // Awaiting the write callback bounds pending output even under backpressure.
    process.stdout.write(`${JSON.stringify(response)}\n`, (error) => {
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
