/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import {
  afterApplicationIsLoadedInjectionToken,
  applicationFeature,
  beforeApplicationIsLoadingInjectionToken,
  onLoadOfApplicationInjectionToken,
  startApplicationInjectionToken,
} from "@freelensapp/application";
import { registerFeature } from "@freelensapp/feature-core";
import { getInjectable } from "@ogre-tools/injectable";
import { computedInjectManyInjectionToken } from "@ogre-tools/injectable-extension-for-mobx";
import { describe, expect, it, vi } from "vitest";
import { initializeRenderer } from "./bootstrap";

// This suite runs in Freelens's Node project without a DOM or Electron mocks.
// Importing the shared entry must not load the full Electron renderer tree.
describe("renderer bootstrap", () => {
  it("registers the host before resolving and invoking application startup", async () => {
    const events: string[] = [];
    let finishStartup!: () => void;
    const completion = new Promise<void>((resolve) => {
      finishStartup = resolve;
    });
    const { di, started } = initializeRenderer({
      environment: "test-renderer",
      register: (container) => {
        events.push("register");
        container.register(
          getInjectable({
            id: "test-start-renderer",
            injectionToken: startApplicationInjectionToken,
            causesSideEffects: true,
            instantiate: () => {
              events.push("resolve-start");
              return () => {
                events.push("start");
                return completion;
              };
            },
          }),
        );
      },
    });

    // Mirrors Electron's extension API publication directly after bootstrap.
    events.push("publish-singletons");
    expect(events).toEqual(["register", "resolve-start", "start", "publish-singletons"]);
    expect(started).toBe(completion);
    expect(di).toBeDefined();
    finishStartup();
    await started;
  });

  it("runs the real application lifecycle in order using the host composition", async () => {
    const events: string[] = [];
    const { started } = initializeRenderer({
      register: (di) => {
        registerFeature(di, applicationFeature);
        for (const [name, injectionToken] of [
          ["before", beforeApplicationIsLoadingInjectionToken],
          ["load", onLoadOfApplicationInjectionToken],
          ["after", afterApplicationIsLoadedInjectionToken],
        ] as const) {
          di.register(
            getInjectable({
              id: `test-${name}`,
              injectionToken,
              instantiate: () => ({
                run: () => {
                  events.push(name);
                },
              }),
            }),
          );
        }
      },
    });

    await started;
    expect(events).toEqual(["before", "load", "after"]);
  });

  it("makes the MobX DI extension available before host registration", async () => {
    const { started } = initializeRenderer({
      register: (di) => {
        registerFeature(di, applicationFeature);
        expect(di.inject(computedInjectManyInjectionToken)).toBeDefined();
      },
    });
    await started;
  });

  it("does not start the application when host registration throws", () => {
    const start = vi.fn();
    const error = new Error("host registration failed");
    expect(() =>
      initializeRenderer({
        register: (di) => {
          di.register(
            getInjectable({
              id: "test-start-renderer",
              injectionToken: startApplicationInjectionToken,
              instantiate: () => start,
            }),
          );
          throw error;
        },
      }),
    ).toThrow(error);
    expect(start).not.toHaveBeenCalled();
  });

  it("exposes lifecycle failures to the host without swallowing them", async () => {
    const error = new Error("mount failed");
    const afterLoad = vi.fn();
    const { started } = initializeRenderer({
      register: (di) => {
        registerFeature(di, applicationFeature);
        di.register(
          getInjectable({
            id: "test-failing-mount",
            injectionToken: onLoadOfApplicationInjectionToken,
            instantiate: () => ({
              run: () => {
                throw error;
              },
            }),
          }),
          getInjectable({
            id: "test-after-load",
            injectionToken: afterApplicationIsLoadedInjectionToken,
            instantiate: () => ({ run: afterLoad }),
          }),
        );
      },
    });
    await expect(started).rejects.toThrow(error);
    expect(afterLoad).not.toHaveBeenCalled();
  });
});
