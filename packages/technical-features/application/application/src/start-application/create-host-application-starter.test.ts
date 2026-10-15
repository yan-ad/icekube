/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createHostApplicationStarter } from "./create-host-application-starter";

describe("createHostApplicationStarter", () => {
  it("runs synchronous hooks immediately, then waits for host readiness", async () => {
    const calls: string[] = [];
    const readiness = Promise.withResolvers<void>();
    const loading = Promise.withResolvers<void>();
    const start = createHostApplicationStarter({
      beforeAnything: () => calls.push("before-anything"),
      beforeHostIsReady: () => calls.push("before-host-ready"),
      whenHostIsReady: () => {
        calls.push("wait-for-host");

        return readiness.promise;
      },
      startApplication: () => {
        calls.push("start-application");

        return loading.promise;
      },
    });

    expect(calls).toEqual([]);

    const started = start();
    let completed = false;

    void started.then(() => {
      completed = true;
    });

    expect(calls).toEqual(["before-anything", "before-host-ready", "wait-for-host"]);

    readiness.resolve();
    await readiness.promise;

    expect(calls).toEqual(["before-anything", "before-host-ready", "wait-for-host", "start-application"]);
    expect(completed).toBe(false);

    loading.resolve();
    await started;

    expect(completed).toBe(true);
  });

  it.each(["beforeAnything", "beforeHostIsReady"] as const)("preserves synchronous failures in %s", (hook) => {
    const error = new Error(hook);
    const beforeAnything = vi.fn();
    const beforeHostIsReady = vi.fn();
    const whenHostIsReady = vi.fn(async () => {});
    const startApplication = vi.fn(async () => {});
    const hooks = { beforeAnything, beforeHostIsReady, whenHostIsReady, startApplication };

    hooks[hook].mockImplementation(() => {
      throw error;
    });

    const start = createHostApplicationStarter(hooks);

    expect(start).toThrow(error);
    expect(whenHostIsReady).not.toHaveBeenCalled();
    expect(startApplication).not.toHaveBeenCalled();

    if (hook === "beforeAnything") {
      expect(beforeHostIsReady).not.toHaveBeenCalled();
    } else {
      expect(beforeAnything).toHaveBeenCalledOnce();
    }
  });

  it.each(["throw", "reject"] as const)("rejects startup when readiness fails through %s", async (failure) => {
    const error = new Error("host failed");
    const startApplication = vi.fn(async () => {});
    const start = createHostApplicationStarter({
      beforeAnything: vi.fn(),
      beforeHostIsReady: vi.fn(),
      whenHostIsReady: () => {
        if (failure === "throw") {
          throw error;
        }

        return Promise.reject(error);
      },
      startApplication,
    });

    await expect(start()).rejects.toBe(error);
    expect(startApplication).not.toHaveBeenCalled();
  });

  it.each(["throw", "reject"] as const)("propagates application failures through %s", async (failure) => {
    const error = new Error("application failed");
    const start = createHostApplicationStarter({
      beforeAnything: vi.fn(),
      beforeHostIsReady: vi.fn(),
      whenHostIsReady: async () => {},
      startApplication: () => {
        if (failure === "throw") {
          throw error;
        }

        return Promise.reject(error);
      },
    });

    await expect(start()).rejects.toBe(error);
  });

  it("does not add single-flight or retry behavior to repeated starts", async () => {
    const beforeAnything = vi.fn();
    const beforeHostIsReady = vi.fn();
    const whenHostIsReady = vi.fn(async () => {});
    const startApplication = vi.fn(async () => {});
    const start = createHostApplicationStarter({
      beforeAnything,
      beforeHostIsReady,
      whenHostIsReady,
      startApplication,
    });

    await start();
    await start();

    expect(beforeAnything).toHaveBeenCalledTimes(2);
    expect(beforeHostIsReady).toHaveBeenCalledTimes(2);
    expect(whenHostIsReady).toHaveBeenCalledTimes(2);
    expect(startApplication).toHaveBeenCalledTimes(2);
  });
});
